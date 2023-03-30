// scrape "clips" from r/tagpro -> after x clips link in terminal
// on approval: download locally -> post to reddit -> get mp4 url from reddit post -> save url to db

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import redditConfig from "./reddit-config.js";
import firebaseConfig from "./firebase-config.js";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, updateDoc } from "firebase/firestore";

const CLIENT_ID = redditConfig.clientId;
const CLIENT_SECRET = redditConfig.clientSecret;
const USERNAME = redditConfig.username;
const PASSWORD = redditConfig.password;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let currentId;

// scrape "clips" from r/tagpro

const LIMIT = 100;
const TIME = 'year';
let token;
let after;
let potentialClips = [];
const unixOneYearAgo = (Date.now() / 1000) - (60*60*24*365);

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
    return await fetch(`https://oauth.reddit.com/r/tagpro/top?t=${TIME}&show=all&limit=${LIMIT}${after ? `&after=${after}` : ''}`, {
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
        if (!post.data.is_self && (TIME != 'all' || post.data.created_utc < unixOneYearAgo)) {
            let url = post.data.url;
            if ((url.includes('imgur') && (url.endsWith('.gif') || url.endsWith('.gifv') || url.endsWith('.mp4'))) || 
                    url.includes('streamable') || url.includes('v.redd.it') || url.includes('gfycat')) {
                potentialClips.push(post);
            }
        }
    });
}

async function saveClip(clip, support) {
    console.log("Saving " + clip.url);
    // Convert url to mp4
    let mp4;
    let ratio;
    if (clip.url.includes('imgur')) {
        ratio = Number(support);
        if (clip.url.endsWith('.gif')) {
            mp4 = clip.url.slice(0, -4) + '.mp4';
        } else if (clip.url.endsWith('.gifv')) {
            mp4 = clip.url.slice(0, -5) + '.mp4';
        } else {
            mp4 = clip.url;
        }
    } else if (clip.url.includes('v.redd.it')) {
        mp4 = clip.media.reddit_video.fallback_url;
        ratio = clip.media.reddit_video.width / clip.media.reddit_video.height;
    } else if (clip.url.includes('gfycat')) {
        let index = clip.url.indexOf('g');
        mp4 = clip.url.slice(0, index) + support + '.' + clip.url.slice(index) + '.mp4';
        ratio = clip.media_embed.width / clip.media_embed.height;
    } else {
        mp4 = support;
        ratio = clip.media_embed.width / clip.media_embed.height;
    }
    if (Number.isNaN(ratio)) {
        console.log('unable to get ratio, please enter it into the db manually');
    }
    // Save mp4 to db
    await updateDoc(doc(db, "meta", "videos"), {amount: currentId});
    await setDoc(doc(db, "videos", currentId.toString()), {
        id: currentId.toString(),
        likes: 0,
        ratio: ratio,
        title: clip.title,
        url: mp4,
        source: clip.permalink
    });
    currentId++;
    // all time id = 89
    // year id = 104
}

async function setId() {
    currentId = await (await getDoc(doc(db, "meta", "videos"))).data().amount + 1;
}

async function main() {
    await setId();
    const rl = readline.createInterface({ input, output });
    while(true) {
        await populatePosts();
        while(potentialClips.length != 0) {
            let clip = potentialClips.shift().data;
            let answer = await rl.question(potentialClips.length + ' ' + clip.url);
            if (answer !== '') {
                saveClip(clip, answer);
            }
        }
    }
}

// main to run script


async function resetAllLikes() {
    let amount = await (await getDoc(doc(db, "meta", "videos"))).data().amount;
    for (let i = 1; i <= amount; i++) {
        await updateDoc(doc(db, "videos", i.toString()), {likes: 0});
    }
}