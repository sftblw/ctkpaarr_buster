import * as fsp from 'fs/promises'

import 'dotenv/config'

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Runnable, RunnableConfig } from '@langchain/core/runnables';
import NoteDataForSpamDetection from './note_data_for_spam_detection.mjs';

export default class SpamDetectorLLM {
    spam_doc: string = '';
    model: string = 'gpt-3.5-turbo-0125';
    chain: Runnable<any, string, RunnableConfig>;
    chain_runner: (message: string) => Promise<string>;

    constructor(model: string) {
        this.model = model;
    }

    async init() {
        const spam_doc = await fsp.readFile("./spam_doc.txt", { encoding: "utf8" });
        this.spam_doc = spam_doc;

        
        this.chain = this.create_chain();
        this.chain_runner = async (message: string) => await this.chain.invoke({
            'message_info': message
        });
    }

    create_chain() {
        const chatModel = new ChatOpenAI({ modelName: this.model });

        const system_message = `
# Role
You are a Fediverse spam detector tasked with identifying spam messages. Focus on these spam indicators:

- Use of specific URLs or phrases commonly associated with spam.
- Attachments with certain images or recognizable spam patterns.
- Excessive mentions of users.
- Usernames that appear randomly generated.
- Lack of user description.
- Users with no followers or following any accounts.

# Recent Spam Patterns
${this.spam_doc}
        `.trim();

        const request_CoT = `
# info
the user got a new message.

# target data

{message_info}

# Possible selections
- spam
- maybe-spam
- not-spam

# task and output format

first, guess and reason whether the message is spam or not.
second, output the decision word.

output in pure json only like below with two keys, "reasoning" and "result".
Your output will be processed by node.js JSON.parse(). output valid json only. don't wrap with markdown. act as API.

{{
"reasoning": "your reasoning",
"result": "not-spam"
}}`.trim();

        const prompt = ChatPromptTemplate.fromMessages([
            ["system", system_message],
            ['assistant', `Okay, I'm prepared to detect spam.`],
            ["user", request_CoT]
        ]);

        const outputParser = new StringOutputParser();

        const llmChain = prompt.pipe(chatModel).pipe(outputParser);

        return llmChain;
    }


    async detect(noteDetail: NoteDataForSpamDetection): Promise<string> {
        const note = noteDetail.note;
        const noteUserDetail = noteDetail.author;
        const ocr_list_values = noteDetail.ocr_data;

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

        const result = await this.chain_runner(message_formatted);

        return result.trim();
    }
}