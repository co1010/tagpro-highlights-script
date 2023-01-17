// scrape "clips" from r/tagpro -> after x clips link in terminal
// on approval: download locally -> post to reddit -> get mp4 url from reddit post -> save url to db


const util = require('util');

// scrape "clips" from r/tagpro

const LIMIT = 100;
let token;
let after;
let potentialClips = [];

async function getRedditApiToken() {
    let headers = new Headers();
    headers.set('Authorization', 'Basic ' + Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET).toString('base64'));
    headers.append('Content-Type', 'application/x-www-form-urlencoded');
    return await fetch('https://www.reddit.com/api/v1/access_token', {
        body: `grant_type=password&username=${USERNAME}&password=${PASSWORD}`,
        headers: headers,
        method: 'POST'
    })
        .then(response => response.json())
        .then(data => data.access_token);
}

async function getTagproPosts() {
    if (!token) {
        token = await getRedditApiToken();
    }
    let headers = new Headers();
    headers.append('Authorization', 'Bearer ' + token);
    headers.append('User-Agent', 'windows:tagpro-highlights-script:v1.0 (by /u/co1010)');
    return await fetch(`https://oauth.reddit.com/r/tagpro/top?t=all&show=all&limit=${LIMIT}${after ? `&after=${after}` : ''}`, {
        headers: headers,
        method: 'GET'
    })
        .then(async function (response) {
            if (!response.ok) {
                console.error(response);
                throw new Error('Error when retrieving posts');
            } else if (Number(response.headers.get('x-ratelimit-remaining')) <= 0) {
                // sleep for number of seconds specified by repsonse
                await new Promise(r => setTimeout(r, Number(response.headers.get('x-ratelimit-reset') * 1000)));
            }
            return response.json();
        })
        .then(data => {
            after = data.data.after;
            console.log(after);
            return data.data.children;
        });
}

async function populatePosts() {
    let posts = await getTagproPosts();
    posts.forEach((post) => {
        if (!post.data.is_self) {
            let url = post.data.url;
            if ((url.includes('imgur') && (url.endsWith('.gif') || url.endsWith('.gifv') || url.endsWith('.mp4'))) || 
                    url.includes('streamable') || url.includes('v.redd.it') || url.includes('gfycat')) {
                potentialClips.push(post);
            }
        }
    });
}

async function downloadClip() {
    // download to ./clips
    console.log('download');
}

async function main() {
    const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const question = util.promisify(rl.question).bind(rl);
    await populatePosts();
    while(true) {
        while(potentialClips.length != 0) {
            let answer = await question(potentialClips.shift().data.url);
            if (answer === 'y') {
                downloadClip();
            }
        }
    }
}

main();
