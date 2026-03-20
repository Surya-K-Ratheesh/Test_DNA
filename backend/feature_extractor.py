import cv2
import numpy as np
import os
import urllib.request
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# 1. Download the required model file automatically if it doesn't exist
MODEL_PATH = 'face_landmarker.task'
if not os.path.exists(MODEL_PATH):
    print("Downloading Face Landmarker model. This only happens once...")
    url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    urllib.request.urlretrieve(url, MODEL_PATH)
    print("Download complete!")

# 2. Initialize the modern Tasks API Face Landmarker
base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.FaceLandmarkerOptions(
    base_options=base_options,
    num_faces=1
)
detector = vision.FaceLandmarker.create_from_options(options)

def process_image(image_bytes, output_directory):
    # Convert the incoming byte data into an OpenCV image
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if image is None:
        return {"error": "Could not decode the image format"}

    height, width, _ = image.shape
    
    # MediaPipe requires RGB color format
    rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    
    # 3. Create a modern MediaPipe Image object
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_image)
    
    # 4. Detect facial landmarks
    detection_result = detector.detect(mp_image)

    if not detection_result.face_landmarks:
        return {"error": "No face detected in the image"}

    # Extract landmarks for the first detected face
    landmarks = detection_result.face_landmarks[0]

    # Specific numerical indices that outline the eyebrows
    left_brow_indices = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
    right_brow_indices = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]

    def get_bounding_box(indices, padding=15):
        x_coords = [int(landmarks[i].x * width) for i in indices]
        y_coords = [int(landmarks[i].y * height) for i in indices]
        
        x_min = max(0, min(x_coords) - padding)
        x_max = min(width, max(x_coords) + padding)
        y_min = max(0, min(y_coords) - padding)
        y_max = min(height, max(y_coords) + padding)
        
        return x_min, x_max, y_min, y_max

    # Ensure the save folder exists
    os.makedirs(output_directory, exist_ok=True)

    # Process and crop the Left Eyebrow
    lx_min, lx_max, ly_min, ly_max = get_bounding_box(left_brow_indices)
    left_brow_img = image[ly_min:ly_max, lx_min:lx_max]
    left_path = os.path.join(output_directory, "left_eyebrow.jpg")
    cv2.imwrite(left_path, left_brow_img)

    # Process and crop the Right Eyebrow
    rx_min, rx_max, ry_min, ry_max = get_bounding_box(right_brow_indices)
    right_brow_img = image[ry_min:ry_max, rx_min:rx_max]
    right_path = os.path.join(output_directory, "right_eyebrow.jpg")
    cv2.imwrite(right_path, right_brow_img)

    return {
        "success": True,
        "left_eyebrow_saved_at": left_path,
        "right_eyebrow_saved_at": right_path
    }