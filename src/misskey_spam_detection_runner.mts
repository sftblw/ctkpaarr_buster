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
import call_mapi_browser_token from './call_mapi_browser_token.mjs';
import SpamDetectorLLM from './spam_detector_llm.mjs';
import NoteDataForSpamDetection from './note_data_for_spam_detection.mjs';


export default class MisskeySpamDetectionRunner {
    client: Client
    ocr_list: Record<string, any>
    detector_list: SpamDetectorLLM[];
    myself: UserDetailed;

    is_initialized: boolean = false;

    constructor(detectorList: SpamDetectorLLM[]) {
        this.detector_list = detectorList;
    }
    
    async init() {
        if (this.is_initialized) {
            return;
        }

        console.log("[tsmi] start");
    
        this.client = new Client({
            host: process.env.MISSKEY_HOST as string,
            token: process.env.MISSKEY_TOKEN as string,
            channels: ["main"],
        });
    
        this.myself = await new Promise((resolve, reject) => {
            this.client.login();
            this.client.once("ready", async (me) => {
                try {
                    const user = await me.user.getMe();
                    resolve(user);
                }
                catch (ex) {
                    reject(ex);
                }
            });
        });
    
    
        const tesseract = await createWorker('eng', OEM.DEFAULT, {cachePath: "model"});
        const vit_gpt2_captioner = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning');
        const trocr_captioner = await pipeline('image-to-text', 'Xenova/trocr-base-printed');

        this.ocr_list = {
            "trocr": trocr_captioner,
            "vit_gpt2": vit_gpt2_captioner,
            "tesseract": (url: string) => tesseract.recognize(url)
        }
    }

    listen_mention() {
        // https://allianaab2m.github.io/tsmi/
        this.client.on("mention", async (note) => {
            await this.handleNote(note);
        });
    }

    async check_recent_mentions(count: number) {
        var result = await call_mapi_browser_token("/notes/mentions", "POST", {limit: count});
        var resultNotes = result as unknown as INote[];

        // console.log(resultNotes)
        resultNotes.forEach(it => this.handleNote(it))
    }

    private async handleNote(note: INote) {
        try {
            return await this.handle_note_body(note);
        } catch (e) {
            console.error(e);
            return new Promise<void>((resolve) => {resolve()});
        }
        
    }

    private async handle_note_body(note: INote) {
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

        console.log('checking OCR');
        let ocr_list = await Promise.allSettled(note.files.map(async (file: any) => {
            let file_url: string = file.url;

            let trocr_caption = await this.ocr_list["trocr"](file_url);
            let vit_gpt2_caption = await this.ocr_list["vit_gpt2"](file_url);
            let tesseract_caption = await this.ocr_list["tesseract"](file_url);

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

        
        const note_detail: NoteDataForSpamDetection = {
            note: note,
            author: noteUserDetail,
            ocr_data: ocr_list_values,
            api_user: this.myself,
        }


        for (let detector of this.detector_list) {
            console.log(`checking detector ${detector.model}`);

            let last_success = false;
            for (let loop = 0; loop < 3; loop++) {
                let result = await detector.detect(note_detail);
                try {
                    let result_json = JSON.parse(result);
                    let reasoning = result_json['reasoning'];
                    let result_data = result_json['result'];

                    if (result_data != 'spam') {
                        console.log(`detected ${detector.model} as not spam`);
                        return;
                    }

                    console.log(`(user ${userInfoString}) llm ${detector.model} thinks :: ${result_data} // ${reasoning}`);

                    last_success = true;
                    break;
                } catch (e) {
                    console.log(`failed to parse ${detector.model} result: ${result}`);
                }
            }
            
            if (last_success == false) {
                console.log(`failed to parse ${detector.model}, out of trying`);
                return;
            }
        }
        
        console.log(`(user ${userInfoString}) (message was ${note.text.replaceAll("\n", " ")})`)
        console.log(`(user ${userInfoString}) acting as a spam`)
        // https://lake.naru.cafe/api/notes/renotes
        // https://legacy.misskey-hub.net/docs/api/endpoints/admin/suspend-user.html
        // call_mapi_browser_token("/notes/delete", "POST", { noteId: note.id });
        // call_mapi_browser_token("/admin/suspend_user", "POST", { userId: note.userId });
    }
}
