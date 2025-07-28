# Sign Language Translator with Meta AI Glasses

## Project Overview

This project is a real-time sign language translator built to work with Meta AI glasses. The application allows wearers to hear sign language translation readouts in real-time as they interact with signers.

## Demo Video

[![Sign Language Translation with Meta AI Glasses](https://img.youtube.com/vi/JgP18E60tOE/0.jpg)](https://www.youtube.com/watch?v=JgP18E60tOE)

Watch our real-time sign language translator in action! The video shows how the system captures sign language via Meta AI glasses and provides immediate audio translations.

## Important Note

This project was developed during a time-constrained hackathon environment and completed in under 10 hours. As a result, both the code quality and product polish are not production-ready. The current implementation:

- Uses screen capture as a workaround due to lack of official Meta AI glasses SDK
- Contains hardcoded values that may need adjustment for your setup
- Has limited error handling and edge case coverage

Consider this a proof of concept that demonstrates the potential of the technology rather than a finished product.

## Setup Instructions

### Prerequisites

- Meta AI glasses
- Laptop with Python installed
- iPhone with Expo Go or ability to run the mobile app
- Node.js and npm
- Instagram account (for streaming)

### Step 1: Server Setup

1. Clone this repository to your computer
2. Navigate to the server directory
3. Install the required Python packages:
   ```bash
   pip install opencv-python numpy mss websockets ultralytics
   ```
4. Update the model path in `streaming.py` to match your local configuration:
   ```python
   # Change this path to where your YOLOv11 model is stored
   model_path = "/path/to/your/best.pt"
   ```
5. Adjust the screen capture area in the `monitor` dictionary if needed:
   ```python
   monitor = {
       "top": 70,
       "left": 260,
       "width": 480,
       "height": 780
   }
   ```
6. Run the streaming server:
   ```bash
   python streaming.py
   ```

### Step 2: Mobile App Setup

1. Navigate to the project root directory
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Expo development server:
   ```bash
   npx expo start
   ```

### Step 3: Meta AI Glasses Setup

1. Pair your Meta AI glasses with your phone following the manufacturer's instructions
2. Set up Instagram streaming on your glasses:
   - Open the Instagram app on your glasses
   - Navigate to streaming settings
   - Start a stream

### Step 4: Connecting Everything

1. On your laptop, make sure the `streaming.py` script is running
2. Position your Instagram stream window from the Meta AI glasses so it aligns with the capture area defined in the `monitor` dictionary
3. The script will display a window showing the captured area with real-time sign language detection
4. On your iPhone, open the mobile app via Expo Go or as a development build
5. Connect to the same WiFi network as your laptop
6. In the mobile app, enter the WebSocket connection details using your laptop's IP address and port 8765 (e.g., "ws://192.168.1.5:8765")
7. When someone signs in front of the glasses, the script will display the detected signs with confidence levels, and these translations will be sent to your mobile app
8. The mobile app will display the translations and read them aloud

## How It Works

The application works through the following process:

1. **Video Capture**: The `streaming.py` script captures a portion of your screen where the Instagram stream from Meta AI glasses is displayed.

2. **Sign Language Detection**: Each captured frame is processed by a YOLOv11 model fine-tuned on sign language gestures. The model detects signs and assigns confidence scores.

3. **WebSocket Broadcasting**: When a sign is detected with sufficient confidence, the translation is broadcast through a WebSocket server running on your computer.

4. **Mobile App Processing**: The Expo mobile app connects to this WebSocket server and receives the translations in real-time (less than 50ms latency).

5. **Audio Feedback**: The mobile app converts the text translations to speech, allowing the wearer to "hear" the sign language.

