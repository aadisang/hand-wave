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

    def preprocess(self, landmarks_sequence: np.ndarray) -> np.ndarray:
        """
        Preprocess landmark sequence for model input.

        Args:
            landmarks_sequence: Array of shape [num_frames, 390] (sequence of flattened frames)

        Returns:
            Preprocessed array ready for model input
        """
        # Convert to float32
        x = landmarks_sequence.astype(np.float32)

        # The model expects the sequence as-is: [num_frames, 390]
        # Internally it will:
        # 1. Reshape each frame [390] → [130, 3]
        # 2. Apply normalization and handle NaNs
        # 3. Process the temporal sequence

        return x

    def predict(self, landmark_frames: list[list[float]]) -> tuple[str, float]:
        """
        Run inference on landmark frames.

        Args:
            landmark_frames: List of frames, each frame is [390] flat array
                           Shape: [num_frames, 390]

        Returns:
            Tuple of (predicted_text, confidence)
        """
        if not landmark_frames:
            return "", 0.0

        # Convert to numpy array: [num_frames, 390]
        sequence_array = np.array(landmark_frames, dtype=np.float32)
        print(f"DEBUG: Input sequence shape: {sequence_array.shape}")
        print(f"DEBUG: Input value range: min={sequence_array.min():.4f}, max={sequence_array.max():.4f}, mean={sequence_array.mean():.4f}")
        print(f"DEBUG: Sample values (first frame, first 10): {sequence_array[0, :10]}")
        print(f"DEBUG: NaN count: {np.isnan(sequence_array).sum()}")

        # The TFLite model expects flattened input: [1, num_frames * 390]
        # Flatten the sequence into a single vector
        input_data = sequence_array.flatten().astype(np.float32)
        print(f"DEBUG: Flattened shape: {input_data.shape}")

        # Resize to match expected shape [1, 390]
        # The model internally handles variable length sequences
        expected_shape = self.input_details[0]["shape"]
        print(f"DEBUG: Expected input shape: {expected_shape}")

        # The model signature expects [1, 390] but processes variable length
        # We need to use resize_tensor_input to set dynamic shape
        num_frames = len(landmark_frames)
        self.interpreter.resize_tensor_input(
            self.input_details[0]["index"],
            [num_frames, 390]
        )
        self.interpreter.allocate_tensors()

        # Now set the tensor with correct shape
        input_data = sequence_array  # [num_frames, 390]
        print(f"DEBUG: Setting tensor with shape: {input_data.shape}")

        self.interpreter.set_tensor(self.input_details[0]["index"], input_data)

        # Run inference ONCE on the entire sequence
        self.interpreter.invoke()

        # Get output
        output = self.interpreter.get_tensor(self.output_details[0]["index"])
        print(f"DEBUG: Model output shape: {output.shape}")

        # The output is token scores for the predicted sequence
        # Shape should be [sequence_length, vocab_size] or [1, sequence_length, vocab_size]
        if len(output.shape) == 3:
            output = output[0]

        # Decode the sequence output
        text, confidence = self.decode_output(output)
        print(f"DEBUG: Decoded text: '{text}', confidence: {confidence}")

        return text, float(confidence)

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
