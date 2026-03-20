from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from feature_extractor import process_image

app = FastAPI()

# Allow your Next.js frontend to talk to this Python backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, change this to your Vercel URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The folder where images will be saved
OUTPUT_DIR = "extracted_features"

@app.post("/api/extract-eyebrows")
async def extract_eyebrows(file: UploadFile = File(...)):
    # Read the image file sent from the frontend
    contents = await file.read()
    
    # Send it to our MediaPipe logic
    result = process_image(contents, OUTPUT_DIR)
    
    if "error" in result:
        return {"status": "failed", "message": result["error"]}
        
    return {
        "status": "success",
        "message": "Eyebrows extracted successfully",
        "data": result
    }