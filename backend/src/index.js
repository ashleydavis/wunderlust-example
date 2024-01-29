const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { db } = require("./db");
const requestIp = require("request-ip");

const app = express();
app.use(cors());
app.use(requestIp.mw());
app.use(express.json());

const port = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
}

const ASSISTANT_ID = process.env.ASSISTANT_ID;
if (!ASSISTANT_ID) {
    throw new Error("Missing ASSISTANT_ID environment variable.");
}

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

app.get('/', (req, res) => {
    res.send('Hello World!');
});

//
// Creates a new chat thread.
//
app.post(`/chat/new`, async (req, res) => {

    const thread = await openai.beta.threads.create();
    res.json({
        threadId: thread.id,
    });
});

//
// Adds a chat message to a thread, sending it to Open AI.
//
async function sendMessage(threadId, text, clientIp) {
    await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: text,
        }
    );

    const run = await openai.beta.threads.runs.create(
        threadId,
        {
            assistant_id: ASSISTANT_ID,
        }
    );

    await db.collection("messages").insertOne({
        addedDate: new Date(),
        threadId,
        runId: run.id,
        text,
        ip: clientIp,
    });
    return run;
}

//
// Sends a new chat message.
//
app.post(`/chat/send`, async (req, res) => {

    const { threadId, text } = req.body;

    const run = await sendMessage(threadId, text, req.clientIp);
    
    res.json({
        runId: run.id,
    });
});

//
// Lists messages for a particular thread.
//
app.post(`/chat/list`, async (req, res) => {

    const { threadId, runId } = req.body;

    const messages = await openai.beta.threads.messages.list(threadId);

    let status = undefined;
    let run = undefined
    if (runId) {
        run = await openai.beta.threads.runs.retrieve(threadId, runId);
        status = run.status;
    }   

    await db.collection("threads").updateOne(
        { _id: threadId },
        {
            $set: {
                updateDate: new Date(),
                messages: messages,
                status,
                ip: req.clientIp,
            },
            $setOnInsert: {
                startDate: new Date(),
            },
        },
        { upsert: true }
    );

    res.json({
        messages: messages.data,
        run,
        status,
    });
});

//
// Submits function outputs for a particular thread.
//
app.post(`/chat/submit`, async (req, res) => {
        
    const { threadId, runId, outputs } = req.body;

    await openai.beta.threads.runs.submitToolOutputs(
        threadId,
        runId,
        {
            tool_outputs: outputs,
        }
    );

    await db.collection("submits").insertOne({
        addedDate: new Date(),
        threadId,
        runId,
        outputs,
        ip: req.clientIp,
    });

    res.sendStatus(200);
});


//
// Stops the middleware for a route.
//
function noMiddleware(req, res, next) {
    next();
};

//
// Submits an audio message to a chat thread.
//
app.post(`/chat/audio`, noMiddleware, async (req, res) => {

    const { threadId } = req.query;
    
    // Convert audio to a Open AI "file" object.
    const file = await OpenAI.toFile(req, "audio.webm");

    // Transcribe the audio file.
    const response = await openai.audio.transcriptions.create({
        model: "whisper-1",
        response_format: "json",
        file,
    })

    // Send the message to the chat thread.
    const run = await sendMessage(threadId, response.text, req.clientIp);
    
    res.json({
        runId: run.id,
    });
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});