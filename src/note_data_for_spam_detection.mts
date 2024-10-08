
import 'dotenv/config'

import { INote } from "tsmi";
import { UserDetailed } from 'tsmi/dist/models/user.js';


export default interface NoteDataForSpamDetection {
    note: INote,
    author: UserDetailed,
    ocr_data: any,
    api_user: UserDetailed,
}