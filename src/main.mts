import 'dotenv/config'

import { createWorker } from 'tesseract.js';
import { Client } from "tsmi";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { pipeline } from '@xenova/transformers';
import { UserDetailed } from 'tsmi/dist/models/user.js';

async function main() {
    console.log("[tsmi] start");

    const client = new Client({
        host: process.env.MISSKEY_HOST as string,
        token: process.env.MISSKEY_TOKEN as string,
        channels: ["main", "localTimeline", "homeTimeline"],
    });

    const myself: UserDetailed = await new Promise((resolve, reject) => {
        client.login();
        client.once("ready", async (me) => {
            try {
                const user = await me.user.getMe();
                resolve(user);
            }
            catch (ex) {
                reject(ex);
            }
        });
    });


    const chatModel = new ChatOpenAI({});
    
    const prompt = ChatPromptTemplate.fromMessages([
        ["system", "You're Fediverse spam detector. Determine It's spam or not. " + 
        "Spam has generally many mentions, random names, from unknown follower. " +
        "Recent example includes discord.gg/ctkpaarr, it's the spam. Some friendly user is mimicking the spam for fun. don't confused by it. " +
        "Output the score. 0 (impossible) ~ 5 (it's definitely a spam). output a single number only."],
        ["user", "{input}"],
    ]);

    const outputParser = new StringOutputParser();
    const llmChain = prompt.pipe(chatModel).pipe(outputParser);

    const vit_gpt2_captioner = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning');
    const trocr_captioner = await pipeline('image-to-text', 'Xenova/trocr-base-printed');
    const tesseract = await createWorker('eng');

    // https://allianaab2m.github.io/tsmi/
    client.on("mention", async (note) => {
        console.log(`got mention from ${note.user.name} ${note.user.username} ${note.user.host}`)
        
        const noteUserDetail = await client.user.get({userId: note.userId});

        let ocr_list = await Promise.allSettled(note.files.map(async (file: any) => {
            let file_url: string = file.url;
            
            let trocr_caption = await trocr_captioner(file_url);
            let vit_gpt2_caption = await vit_gpt2_captioner(file_url);
            let tesseract_caption = await tesseract.recognize(file_url);
            
            let result = {
                "trocr": trocr_caption[0]['generated_text'],
                "vit_gpt2": vit_gpt2_caption[0]['generated_text'],
                "tesseract": tesseract_caption.data.text
            };
            console.log(result);
            return result;
        }));
        const ocr_list_values = ocr_list
            .filter(result => result.status === 'fulfilled') // 성공한 프로미스만 필터링
            .map(result => (result as any).value); // 각각의 'value' 속성을 추출

            

        const message_formatted = `
me.name: ${myself.name}
me.username: ${myself.username}
me.host: ${myself.host}
suspect.name ${note.user.name}
suspect.username: ${note.user.username}
suspect.host: ${note.user.host}
suspect.followersCount: ${noteUserDetail.followersCount}
suspect.followingCount: ${noteUserDetail.followingCount}
suspect.isFollowed: ${noteUserDetail.isFollowed}
suspect.isFollowing: ${noteUserDetail.isFollowing}
suspect.description.substring(0, 32): ${noteUserDetail.description?.substring(0, 32)?.replaceAll("\n", "\\n")}
suspect.note.text: ${note.text}
suspect.image_ocr.list: ${JSON.stringify(ocr_list_values)}
        `.trim();

        console.log(message_formatted);
        const result = await llmChain.invoke({input: message_formatted})
        console.log(`llm says: ${result.trim()}/5`)
        
        const friendlyFire = noteUserDetail.isFollowing || noteUserDetail.isFollowed;
        if (result.trim() == "5" && !friendlyFire) {
            
            // https://lake.naru.cafe/api/notes/renotes
            // https://legacy.misskey-hub.net/docs/api/endpoints/admin/suspend-user.html
            // sadly, suspending instance-wide (admin/suspend-user) cannot be done,
            // since API moderation is blocked by firefish at the source level
            console.log("blocking the user");
            const endpoint = `${client.host}/api/blocking/create`;
            console.log(note.userId);
            try {
                const result = await fetch(
                    endpoint,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({i: process.env.MISSKEY_TOKEN, userId: note.userId}), // JavaScript 객체를 JSON 문자열로 변환
                    }
                );
    
                console.log(result.status)
                if (result.status >= 400) {
                    console.log(await result.json())
                }
            } catch (ex) {
                console.log(ex);
            }

        }
    });
}

main();