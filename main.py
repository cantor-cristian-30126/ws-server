from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
import os

app = FastAPI()

UPLOAD_FILE = "intruder.jpg"

@app.get("/")
def root():
    return {"message": "Server works"}

@app.post("/upload")
async def upload_image(request: Request):
    data = await request.body()
    with open(UPLOAD_FILE, "wb") as f:
        f.write(data)
    print("Image received (standard)")
    return {"status": "OK"}

@app.post("/upload-esp")
async def upload_image_esp(request: Request):
    data = await request.body()
    with open(UPLOAD_FILE, "wb") as f:
        f.write(data)
    print("Image received from ESP32")
    return {"status": "OK"}

@app.get("/intruder.jpg")
def get_image():
    if os.path.exists(UPLOAD_FILE):
        # ⬇️ no-cache ca Android să nu servească imaginea veche
        return FileResponse(
            UPLOAD_FILE,
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Pragma": "no-cache"
            }
        )
    return {"error": "No image"}