import * as fsp from 'fs/promises'

import 'dotenv/config'

import { createWorker } from 'tesseract.js';
import { Client, INote } from "tsmi";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { pipeline } from '@xenova/transformers';
import { UserDetailed } from 'tsmi/dist/models/user.js';
import { Runnable, RunnableConfig } from 'langchain/runnables';

async function call_mapi_browser_token(endpoint_chunk: string = "/blocking/create", method: string = "POST", body: Record<string, any> = {}): Promise<any> {
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
            
        } else {
            console.log("success: " + endpoint)
        }
        try {
            return await result.json()
        } catch (ex) {
            // no result
            return new Promise(() => {})
        }
    } catch (ex) {
        console.log(ex);
        return new Promise(() => {})
    }
}

class MisskeySpamDetector {
    client: Client
    llmChain: Runnable<any, string, RunnableConfig>
    ocrList: Record<string, any>

    constructor(client: Client, llmChain: Runnable<any, string, RunnableConfig>, ocrList: Record<string, any>) {
        this.client = client;
        this.llmChain = llmChain;
        this.ocrList = ocrList;
    }
    
    static async create() {
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
            ["system", `
As a Fediverse spam detector, your role is to analyze messages and determine whether they are spam or ham based on specific characteristics. Characteristics of spam include: 
- Containing specific URLs or phrases
- Including certain images or patterns in attachments
- Having many mentions
- Featuring randomly-generated usernames
- Missing user descriptions
- Users having no followers or followings

Given the detailed metadata and content of a suspect message below, decide whether it is "spam" or "ham". only print "spam" or "ham" without quotes.
        `.trim()],
            ["user", `{input}`.trim()],
        ]);
        
    
        const outputParser = new StringOutputParser();
        const llmChain = prompt.pipe(chatModel).pipe(outputParser);
    
        const vit_gpt2_captioner = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning');
        const trocr_captioner = await pipeline('image-to-text', 'Xenova/trocr-base-printed');
        const tesseract = await createWorker('eng');

        return new MisskeySpamDetector(
            client,
            llmChain,
            {
                "trocr": trocr_captioner,
                "vit_gpt2": vit_gpt2_captioner,
                "tesseract": (url: string) => tesseract.recognize(url)
            }
            
        )
    }

    listenMention() {
        // https://allianaab2m.github.io/tsmi/
        this.client.on("mention", async (note) => {
            await this.handleNote(note);
        });
    }

    async checkRecentMentions(count: number) {
        var result = await call_mapi_browser_token("/notes/mentions", "POST", {limit: count});
        var resultNotes = result as unknown as INote[];

        console.log(resultNotes)
        resultNotes.forEach(it => this.handleNote(it))
    }

    private async handleNote(note: INote) {
        console.log(`got mention from ${note.user.name} ${note.user.username} ${note.user.host}`);

        const noteUserDetail = await this.client.user.get({ userId: note.userId });

        let ocr_list = await Promise.allSettled(note.files.map(async (file: any) => {
            let file_url: string = file.url;

            let trocr_caption = await this.ocrList["trocr"](file_url);
            let vit_gpt2_caption = await this.ocrList["vit_gpt2"](file_url);
            let tesseract_caption = await this.ocrList["tesseract"](file_url);

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
## Meta Information
- Suspect Name: ${note.user.name}
- Username: ${note.user.username}
- Host: ${note.user.host}
- Followers Count: ${noteUserDetail.followersCount}
- Following Count: ${noteUserDetail.followingCount}
- Is Followed: ${noteUserDetail.isFollowed ? 'Yes' : 'No'}
- Is Following: ${noteUserDetail.isFollowing ? 'Yes' : 'No'}
- User Description: ${noteUserDetail.description?.substring(0, 32) ?? 'None'}

## Main Content
- Body Text: ${note.text}
- Image OCR Results: ${JSON.stringify(ocr_list_values)}
`.trim();


        console.log(message_formatted);
        const result = await this.llmChain.invoke({ input: message_formatted });
        console.log(`llm says: ${result.trim()}`);

        const friendlyFire = noteUserDetail.isFollowing || noteUserDetail.isFollowed;

        if (result.trim() == "spam" && !friendlyFire) {
            // https://lake.naru.cafe/api/notes/renotes
            // https://legacy.misskey-hub.net/docs/api/endpoints/admin/suspend-user.html
            call_mapi_browser_token("/notes/delete", "POST", { userId: note.userId });
            call_mapi_browser_token("/admin/suspend_user", "POST", { userId: note.userId });
        }
    }
}

async function main() {

    console.log("loading app")
    const detector = await MisskeySpamDetector.create();
    console.log("listening")
    detector.listenMention()
    console.log("recent mentions")
    await detector.checkRecentMentions(3);
}

main();