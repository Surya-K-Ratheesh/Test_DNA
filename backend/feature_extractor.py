import cv2  # type: ignore
import numpy as np  # type: ignore
import os
import urllib.request
import mediapipe as mp  # type: ignore
from mediapipe.tasks import python  # type: ignore
from mediapipe.tasks.python import vision  # type: ignore

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

    # MediaPipe robust eye indices
    left_eye_indices = [33, 133, 160, 159, 158, 144, 145, 153]
    right_eye_indices = [362, 263, 387, 386, 385, 373, 374, 380]

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

    def get_dominant_color(img_crop):
        if img_crop is None or img_crop.size == 0:
            return "#000000"
        avg_color_per_row = np.average(img_crop, axis=0)
        avg_color = np.average(avg_color_per_row, axis=0) # [B, G, R]
        b, g, r = int(avg_color[0]), int(avg_color[1]), int(avg_color[2])
        return f"#{r:02x}{g:02x}{b:02x}"

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

    # Process left and right eyes
    ex_min_l, ex_max_l, ey_min_l, ey_max_l = get_bounding_box(left_eye_indices, padding=5)
    left_eye_img = image[ey_min_l:ey_max_l, ex_min_l:ex_max_l]
    left_eye_path = os.path.join(output_directory, "left_eye.jpg")
    cv2.imwrite(left_eye_path, left_eye_img)
    l_color = get_dominant_color(left_eye_img)
    
    ex_min_r, ex_max_r, ey_min_r, ey_max_r = get_bounding_box(right_eye_indices, padding=5)
    right_eye_img = image[ey_min_r:ey_max_r, ex_min_r:ex_max_r]
    right_eye_path = os.path.join(output_directory, "right_eye.jpg")
    cv2.imwrite(right_eye_path, right_eye_img)
    r_color = get_dominant_color(right_eye_img)

    return {
        "success": True,
        "left_eyebrow_saved_at": left_path,
        "right_eyebrow_saved_at": right_path,
        "left_eye_saved_at": left_eye_path,
        "right_eye_saved_at": right_eye_path,
        "eye_color_left": l_color,
        "eye_color_right": r_color,
        "eye_color": l_color
    }