import * as fsp from 'fs/promises'

import 'dotenv/config'

import { OEM, createWorker } from 'tesseract.js';
import { Client, INote } from "tsmi";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { pipeline } from '@xenova/transformers';
import { UserDetailed } from 'tsmi/dist/models/user.js';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { ChatMessageHistory } from "langchain/stores/message/in_memory";

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
    llmRun: (message: string) => Promise<string>;
    ocrList: Record<string, any>

    constructor(client: Client, llmRun: (message: string) => Promise<string>, ocrList: Record<string, any>) {
        this.client = client;
        this.llmRun = llmRun;
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
    
        const chatModel = new ChatOpenAI({modelName: process.env.OPENAI_MODEL_NAME ?? 'gpt-3.5-turbo-0125'});
        
        const prompt = ChatPromptTemplate.fromMessages([
            ["system", `
As a Fediverse spam detector, you're tasked with identifying spam messages. Focus on these spam indicators:

- Use of specific URLs or phrases commonly associated with spam.
- Attachments with certain images or recognizable spam patterns.
- Excessive mentions of users.
- Usernames that appear randomly generated.
- Lack of user description.
- Users with no followers or following any accounts.

Recent spam patterns include:
${spam_doc}

User will request about a single message, in two times.
- first: asking reasons. Your job is reasoning about whether it is spam or not.
- second: asking result, for acting. Your job is deciding, only printing "spam" or "ham" without quote and without explanation or additional sentence. only single word.
            `.trim()],
            
            new MessagesPlaceholder("history")
        ]);

        const llmChain = prompt.pipe(chatModel);

        const chainWithHistory = new RunnableWithMessageHistory({
            runnable: llmChain,
            getMessageHistory: (sessionIdAsObj) => sessionIdAsObj,
            inputMessagesKey: "input",
            historyMessagesKey: "history",
        });

        const outputParser = new StringOutputParser();

        const llmRun = async (message: string) => {
            const history = new ChatMessageHistory();
            const firstRequest = `
User got a new message. Below is the detail of the message with metadata.
\`\`\`
${message}
\`\`\`
Based on the spam indicators provided (specific URLs or phrases, images, mentions, usernames, user descriptions, followers), classify this message as "spam" or "ham". Provide concise reasons for your classification focusing on the mentioned indicators, and whether it is spam or ham.
reasons:
            `.trim()

            const _result = await chainWithHistory.invoke(
                {input: firstRequest},
                {configurable: {sessionId: history}}
            )

            const secondRequest = `
You've reasoned about this message. So, now, decide with a single word response "spam" or "ham. not a sentence. Act like a API which return either "spam" or "ham" in plain text. result [spam/ham]:
            `.trim();            

            const result2 = await chainWithHistory.invoke(
                {input: secondRequest},
                {configurable: {sessionId: history}}
            );
                
            const output = await outputParser.invoke(result2);

            return output;
        }
    
        const tesseract = await createWorker('eng', OEM.DEFAULT, {cachePath: "model"});
        const vit_gpt2_captioner = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning');
        const trocr_captioner = await pipeline('image-to-text', 'Xenova/trocr-base-printed');

        return new MisskeySpamDetector(
            client,
            llmRun,
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
        try {
            return await this.handleNoteBody(note);
        } catch (e) {
            console.error(e);
            return new Promise<void>((resolve) => {resolve()});
        }
        
    }
    private async handleNoteBody(note: INote) {
        const userInfoString = `${note.user.name} ${note.user.username} ${note.user.host}`;
        console.log(`got mention from ${userInfoString}`);

        const noteUserDetail = await this.client.user.get({ userId: note.userId });

        const friendlyFire = noteUserDetail.isFollowing || noteUserDetail.isFollowed;

        if (friendlyFire) {
            console.log(`it is friendlyFire. skipping. user: ${userInfoString} isFollowing: ${noteUserDetail.isFollowing} isFollowed: ${noteUserDetail.isFollowed}`);
            return;
        }

        if (noteUserDetail.isSuspended) {
            console.log(`user is already suspended. user: ${userInfoString} isFollowing: ${noteUserDetail.isFollowing} isFollowed: ${noteUserDetail.isFollowed}`);
            return;
        }

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

        const result = await this.llmRun(message_formatted);
        console.log(`(user ${userInfoString}) llm says: ${result.trim()}`);

        if (result.trim() == "spam" && !friendlyFire) {
            console.log(`(user ${userInfoString}) acting as a spam`)
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