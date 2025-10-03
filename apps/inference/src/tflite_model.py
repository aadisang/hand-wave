"""TFLite model wrapper for ASL Fingerspelling Recognition."""

import json
from pathlib import Path

import numpy as np
import tensorflow as tf


class TFLiteModel:
    """Wrapper for TFLite ASL model inference."""

    def __init__(
        self,
        model_path: str,
        inference_args_path: str,
        char_map_path: str,
    ):
        """
        Initialize TFLite interpreter.

        Args:
            model_path: Path to .tflite model file
            inference_args_path: Path to inference_args.json
            char_map_path: Path to character_to_prediction_index.json
        """
        # Load the TFLite model
        self.interpreter = tf.lite.Interpreter(model_path=model_path)
        self.interpreter.allocate_tensors()

        # Get input and output details
        self.input_details = self.interpreter.get_input_details()
        self.output_details = self.interpreter.get_output_details()

        # Load inference args (contains selected columns)
        with open(inference_args_path) as f:
            self.inference_args = json.load(f)
            self.selected_columns = self.inference_args["selected_columns"]

        # Load character mapping
        with open(char_map_path) as f:
            char_to_num = json.load(f)

        # Add special tokens: P (pad), S (start), E (end)
        n = len(char_to_num)
        char_to_num["P"] = n
        char_to_num["S"] = n + 1
        char_to_num["E"] = n + 2

        self.char_to_num = char_to_num
        self.num_to_char = {v: k for k, v in char_to_num.items()}

        print(f"✓ Model loaded: {model_path}")
        print(f"  Input shape: {self.input_details[0]['shape']}")
        print(f"  Output shape: {self.output_details[0]['shape']}")
        print(f"  Selected columns: {len(self.selected_columns)}")
        print(f"  Vocabulary size: {len(self.num_to_char)}")

    def preprocess(self, landmarks_flat: np.ndarray) -> np.ndarray:
        """
        Preprocess flat landmark array for model input.

        Args:
            landmarks_flat: Array of shape [390] (single frame, flattened)

        Returns:
            Preprocessed array ready for model input [1, 390]
        """
        # Ensure shape is [1, 390]
        if landmarks_flat.shape == (390,):
            landmarks_flat = landmarks_flat[np.newaxis, :]

        # Convert to float32
        x = landmarks_flat.astype(np.float32)

        # Model internally does:
        # 1. Reshape [390] → [3, 130]
        # 2. Transpose → [130, 3]
        # 3. Normalize & fill NaNs
        # We just need to ensure proper format

        return x

    def predict(self, landmark_frames: list[list[float]]) -> tuple[str, float]:
        """
        Run inference on landmark frames.

        Args:
            landmark_frames: List of frames, each frame is [390] flat array

        Returns:
            Tuple of (predicted_text, confidence)
        """
        if not landmark_frames:
            return "", 0.0

        all_predictions = []
        all_confidences = []

        # Process each frame independently
        for frame in landmark_frames:
            frame_array = np.array(frame, dtype=np.float32)

            # Preprocess single frame
            input_data = self.preprocess(frame_array)

            # Set input tensor
            self.interpreter.set_tensor(self.input_details[0]["index"], input_data)

            # Run inference
            self.interpreter.invoke()

            # Get output: [sequence_length, vocab_size]
            output = self.interpreter.get_tensor(self.output_details[0]["index"])

            # Decode this frame's output
            text, conf = self.decode_output(output)
            all_predictions.append(text)
            all_confidences.append(conf)

        # Combine predictions from all frames
        final_text = "".join(all_predictions)
        final_confidence = np.mean(all_confidences) if all_confidences else 0.0

        return final_text, float(final_confidence)

    def decode_output(self, output: np.ndarray) -> tuple[str, float]:
        """
        Decode model output to text.

        Args:
            output: Model output array [sequence_length, vocab_size] of logits

        Returns:
            Tuple of (decoded_text, confidence)
        """
        # Get token IDs via argmax over vocabulary dimension
        token_ids = np.argmax(output, axis=-1)

        # Get confidence scores (max probabilities)
        # Apply softmax to logits
        exp_output = np.exp(output - np.max(output, axis=-1, keepdims=True))
        probs = exp_output / np.sum(exp_output, axis=-1, keepdims=True)
        confidences = np.max(probs, axis=-1)

        # Convert tokens to characters
        chars = []
        for token_id in token_ids:
            if int(token_id) in self.num_to_char:
                char = self.num_to_char[int(token_id)]
                # Skip pad and start tokens, stop at end token
                if char == "E":
                    break
                elif char not in ["P", "S"]:
                    chars.append(char)

        text = "".join(chars)
        confidence = float(np.mean(confidences))

        return text, confidence
