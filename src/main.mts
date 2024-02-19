import * as fsp from 'fs/promises'

import 'dotenv/config'

import { createWorker } from 'tesseract.js';
import { Client } from "tsmi";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { pipeline } from '@xenova/transformers';
import { UserDetailed } from 'tsmi/dist/models/user.js';

async function call_mapi_browser_token(endpoint_chunk: string = "/blocking/create", method: string = "POST", body: Record<string, string> = {}) {
    const endpoint = `${process.env.MISSKEY_HOST}/api${endpoint_chunk}`;
    
    try {
        const result = await fetch(
            endpoint,
            {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    "authorization": `Bearer ${process.env.MISSKEY_BEARER}`
                },
                body: JSON.stringify(body), // JavaScript 객체를 JSON 문자열로 변환
            }
        );

        if (result.status >= 400) {
            console.log(await result.json())
        } else {
            console.log("success: " + endpoint)
        }
    } catch (ex) {
        console.log(ex);
    }
}

async function main() {
    const spam_doc = await fsp.readFile("./spam_doc.txt", {encoding: "utf8"});
    console.log("[tsmi] start");

    const client = new Client({
        host: process.env.MISSKEY_HOST as string,
        token: process.env.MISSKEY_TOKEN as string,
        channels: ["main"],
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
        ["system", "You're Fediverse spam detector. Determine It's spam or not.\n" + 
        "Some characteristics of spams include:\n"+
        "```\n" +
        spam_doc +
        "\n```\n" +
        "Output the single number of score: 0 (not a spam) ~ 5 (definitely a spam). just number only."],
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
        console.log(`llm says: ${result.trim()}`)
        
        const friendlyFire = noteUserDetail.isFollowing || noteUserDetail.isFollowed;

        if (result.trim() == "5" && !friendlyFire) {
            // https://lake.naru.cafe/api/notes/renotes
            // https://legacy.misskey-hub.net/docs/api/endpoints/admin/suspend-user.html
            call_mapi_browser_token("/notes/delete", "POST", {userId: note.userId});
            call_mapi_browser_token("/admin/suspend_user", "POST", {userId: note.userId});
        }
    });
}

main();