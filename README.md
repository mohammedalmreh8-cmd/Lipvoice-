# LipVoice

A camera-based lip reading assistant for people who have lost their voice.

The browser watches your mouth, predicts the phrase you are mouthing, and can speak it aloud.

## How to use

1. Open the app and allow camera access. Video never leaves this device.
2. Keep your face in the frame. Mouth a word, then pause.
3. Confirm the prediction, tap a quick phrase, or press **Speak it aloud**.
4. Open **Train phrases** and mouth each important sentence three times to personalize recognition.

## What it can do

- Live lip landmark tracking with MediaPipe Face Landmarker
- Built-in guesses for essentials such as Yes, No, Help, Water, Pain
- Personal phrase training stored in the browser
- Text-to-speech playback and a conversation log
- Large, high-contrast controls for easier use

## Run locally

```bash
npm install
npm run dev
```
