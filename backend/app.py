from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn


app = FastAPI(
    title="JARVIS Backend",
    version="0.1.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Message(BaseModel):
    message: str



@app.get("/")
def home():

    return {
        "status": "online",
        "assistant": "JARVIS"
    }



@app.post("/chat")
def chat(data: Message):

    return {
        "reply": f"I received: {data.message}"
    }



if __name__ == "__main__":

    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )