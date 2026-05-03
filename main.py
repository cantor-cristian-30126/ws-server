from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
import os

app = FastAPI()

UPLOAD_FILE = "intruder.jpg"

# 🟢 TEST SERVER
@app.get("/")
def root():
    return {"message": "Server works"}

# 🟢 ENDPOINT STANDARD (pentru test din PC / browser)
@app.post("/upload")
async def upload_image(request: Request):
    data = await request.body()

    with open(UPLOAD_FILE, "wb") as f:
        f.write(data)

    print("Image received (standard)")
    return {"status": "OK"}

# 🟢 ENDPOINT SPECIAL PENTRU ESP32 (IMPORTANT)
@app.post("/upload-esp")
async def upload_image_esp(request: Request):
    data = await request.body()

    with open(UPLOAD_FILE, "wb") as f:
        f.write(data)

    print("Image received from ESP32")
    return {"status": "OK"}

# 🟢 RETURN IMAGINE
@app.get("/intruder.jpg")
def get_image():
    if os.path.exists(UPLOAD_FILE):
        return FileResponse(UPLOAD_FILE)
    return {"error": "No image"}