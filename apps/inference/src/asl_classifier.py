"""ASL Sign Language Classifier using TFLite models.

Based on the Gesture Quest ASL detector.
Supports both static signs (alphabet A-Z + phrases) and movement signs.
"""

import copy
import csv
import itertools
from pathlib import Path
from typing import Tuple

import numpy as np
import tensorflow as tf


class ASLClassifier:
    """ASL Sign Language Classifier for static and movement signs."""

    def __init__(
        self,
        static_model_path: str,
        movement_model_path: str,
        label_path: str,
        output_count: int = 5,
        num_threads: int = 1,
    ):
        """
        Initialize ASL Classifier with static and movement models.

        Args:
            static_model_path: Path to static signs .tflite model
            movement_model_path: Path to movement signs .tflite model
            label_path: Path to label.csv file
            output_count: Number of top predictions to return
            num_threads: Number of threads for TFLite interpreter
        """
        # Load static model (alphabet + phrases)
        self.static_interpreter = tf.lite.Interpreter(
            model_path=static_model_path, num_threads=num_threads
        )
        self.static_interpreter.allocate_tensors()
        self.static_input_details = self.static_interpreter.get_input_details()
        self.static_output_details = self.static_interpreter.get_output_details()

        # Load movement model
        self.movement_interpreter = tf.lite.Interpreter(
            model_path=movement_model_path, num_threads=num_threads
        )
        self.movement_interpreter.allocate_tensors()
        self.movement_input_details = self.movement_interpreter.get_input_details()
        self.movement_output_details = self.movement_interpreter.get_output_details()

        # Load labels (robust to blank lines and BOM)
        with open(label_path, encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            labels: list[str] = []
            for row in reader:
                if not row:
                    continue
                label = row[0].strip()
                if not label:
                    continue
                labels.append(label)
            self.labels = labels

        self.output_count = output_count

        # Movement sign mapping (from original implementation)
        # Maps movement model indices to label indices
        self.movement_dict = {0: -1, 1: 9, 2: 25}  # TODO: Expand for more movements

        print(f"✓ Static model loaded: {static_model_path}")
        print(f"  Input shape: {self.static_input_details[0]['shape']}")
        print(f"  Output shape: {self.static_output_details[0]['shape']}")
        print(f"✓ Movement model loaded: {movement_model_path}")
        print(f"  Input shape: {self.movement_input_details[0]['shape']}")
        print(f"  Labels loaded: {len(self.labels)} classes")

    def predict_static(
        self, landmarks: list[list[float]]
    ) -> Tuple[list[int], list[float]]:
        """
        Predict static sign from hand landmarks (single frame).

        Args:
            landmarks: List of 21 landmarks [[x, y], ...] from MediaPipe hand

        Returns:
            Tuple of (top_N_indices, top_N_probabilities)
        """
        # Preprocess landmarks
        preprocessed = self._preprocess_landmark(landmarks)

        # Run inference
        self.static_interpreter.set_tensor(
            self.static_input_details[0]["index"],
            np.array([preprocessed], dtype=np.float32),
        )
        self.static_interpreter.invoke()

        # Get results
        result = self.static_interpreter.get_tensor(
            self.static_output_details[0]["index"]
        )

        # Get top N results
        indices, probs = self._max_n_results(np.squeeze(result), self.output_count)

        return indices.tolist(), probs.tolist()

    def predict_movement(
        self, landmark_sequence: list[list[list[float]]], image_width: int, image_height: int
    ) -> Tuple[list[int], list[float]]:
        """
        Predict movement sign from sequence of hand landmarks.

        Args:
            landmark_sequence: Sequence of 21 frames, each with 21 landmarks [[x, y], ...]
            image_width: Width of the image for normalization
            image_height: Height of the image for normalization

        Returns:
            Tuple of (top_N_indices, top_N_probabilities)
        """
        # Preprocess movement sequence
        preprocessed = self._preprocess_hand_movement(
            landmark_sequence, image_width, image_height
        )

        # Run inference
        self.movement_interpreter.set_tensor(
            self.movement_input_details[0]["index"],
            np.array([preprocessed], dtype=np.float32),
        )
        self.movement_interpreter.invoke()

        # Get results
        result = self.movement_interpreter.get_tensor(
            self.movement_output_details[0]["index"]
        )

        # Get top N results
        indices, probs = self._max_n_results(np.squeeze(result), self.output_count)

        # Map movement indices to label indices
        indices = np.array([self.movement_dict.get(idx, -1) for idx in indices])

        return indices.tolist(), probs.tolist()

    def _preprocess_landmark(self, landmark_list: list[list[float]]) -> list[float]:
        """
        Normalize landmark to fit model (relative coordinates + normalization).

        Args:
            landmark_list: List of 21 landmarks [[x, y], ...]

        Returns:
            Flattened normalized landmark list [42 values]
        """
        temp_landmark_list = copy.deepcopy(landmark_list)

        # Convert to relative coordinates (relative to wrist - index 0)
        base_x, base_y = 0, 0
        for index, landmark_point in enumerate(temp_landmark_list):
            if index == 0:
                base_x, base_y = landmark_point[0], landmark_point[1]

            temp_landmark_list[index][0] = temp_landmark_list[index][0] - base_x
            temp_landmark_list[index][1] = temp_landmark_list[index][1] - base_y

        # Convert to one-dimensional list
        temp_landmark_list = list(itertools.chain.from_iterable(temp_landmark_list))

        # Normalization
        max_value = max(list(map(abs, temp_landmark_list)))

        if max_value != 0:
            temp_landmark_list = [n / max_value for n in temp_landmark_list]

        return temp_landmark_list

    def _preprocess_hand_movement(
        self,
        m_sequence: list[list[list[float]]],
        image_width: int,
        image_height: int,
    ) -> list[float]:
        """
        Normalize landmark sequences to fit movement model.

        Args:
            m_sequence: Sequence of 21 frames [[landmarks], ...] each with 21 landmarks
            image_width: Image width for normalization
            image_height: Image height for normalization

        Returns:
            Flattened normalized sequence [882 values = 21 frames * 21 landmarks * 2]
        """
        SEQUENCE_FRAME_NUM = 21
        copy_of_m_sequence = copy.deepcopy(m_sequence)

        landmarks_seq = []

        # Save first coordinates for replacing start sequence landmarks position
        first_seq_landmarks = copy.deepcopy(copy_of_m_sequence[0])

        for seq in range(0, SEQUENCE_FRAME_NUM):
            landmarks_seq.append(list(np.array(copy_of_m_sequence[seq]).flatten()))

        # Convert to relative coordinates
        first_seq_landmarks_flatten = copy.deepcopy(landmarks_seq[0])

        for seq in range(0, SEQUENCE_FRAME_NUM):
            for landmark in range(0, 21 * 2):
                if (landmark % 2) == 0:  # x coordinate
                    landmarks_seq[seq][landmark] = (
                        landmarks_seq[seq][landmark] - first_seq_landmarks_flatten[landmark]
                    ) / image_width
                else:  # y coordinate
                    landmarks_seq[seq][landmark] = (
                        landmarks_seq[seq][landmark] - first_seq_landmarks_flatten[landmark]
                    ) / image_height

        # Replace first sequence with start sequence landmarks position
        if first_seq_landmarks[0][0] != 0 and first_seq_landmarks[0][1] != 0:
            landmarks_seq[0] = self._preprocess_landmark(first_seq_landmarks)

        # Convert to one-dimensional list
        landmarks_seq = list(itertools.chain.from_iterable(landmarks_seq))

        return landmarks_seq

    def _max_n_results(self, result_probs: np.ndarray, n: int) -> Tuple[np.ndarray, np.ndarray]:
        """
        Get top N results from probability array.

        Args:
            result_probs: Probability array from model output
            n: Number of top results to return

        Returns:
            Tuple of (indices, probabilities)
        """
        result_probs_sorted = np.argsort(result_probs)
        result_probs_descen_sorted = result_probs_sorted[::-1]  # descending order

        max_n_index = result_probs_descen_sorted[:n]
        max_n_probs = result_probs[max_n_index]

        return max_n_index, max_n_probs

    def get_label(self, index: int) -> str:
        """Get label string from index."""
        if 0 <= index < len(self.labels):
            return self.labels[index]
        return "Unknown"
