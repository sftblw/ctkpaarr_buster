import 'dotenv/config'

import MisskeySpamDetectionRunner from './misskey_spam_detection_runner.mjs';
import SpamDetectorLLM from './spam_detector_llm.mjs';


async function main() {

    console.log("loading app")

    let detector_small = new SpamDetectorLLM(process.env.OPENAI_MODEL_NAME_SMALL ?? 'gpt-4o-mini')
    let detector_large = new SpamDetectorLLM(process.env.OPENAI_MODEL_NAME_LARGE ?? 'gpt-4o')

    await detector_small.init();
    await detector_large.init();

    let detectors = [detector_small, detector_large];
    let runner = new MisskeySpamDetectionRunner(
        detectors
    );

    await runner.init();

    console.log("listening")
    runner.listen_mention();
    
    console.log("recent mentions")
    await runner.check_recent_mentions(1);
}

main();