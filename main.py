from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
import os

app = FastAPI()

UPLOAD_FILE = "intruder.jpg"

@app.post("/upload")
async def upload_image(request: Request):
    data = await request.body()

    with open(UPLOAD_FILE, "wb") as f:
        f.write(data)

    print("Image received!")
    return {"status": "OK"}

@app.get("/intruder.jpg")
def get_image():
    if os.path.exists(UPLOAD_FILE):
        return FileResponse(UPLOAD_FILE)
    return {"error": "No image"}

@app.get("/")
def root():
    return {"message": "Server works"}