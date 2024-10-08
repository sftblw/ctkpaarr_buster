export default async function call_mapi_browser_token(endpoint_chunk: string = "/blocking/create", method: string = "POST", body: Record<string, any> = {}): Promise<any> {
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