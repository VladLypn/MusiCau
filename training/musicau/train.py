from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchaudio
from sklearn.metrics import classification_report
from sklearn.preprocessing import LabelEncoder
from torch.utils.data import DataLoader, Dataset


SAMPLE_RATE = 22050
N_MELS = 96
N_FFT = 2048
HOP_LENGTH = 256


@dataclass(frozen=True)
class TrainingConfig:
    metadata: Path
    audio_root: Path
    model: str
    batch_size: int
    epochs: int
    learning_rate: float
    noise_probability: float


class GuitarDataset(Dataset):
    def __init__(
        self,
        frame: pd.DataFrame,
        audio_root: Path,
        label_encoder: LabelEncoder,
        augment: bool,
        noise_probability: float,
    ) -> None:
        self.frame = frame.reset_index(drop=True)
        self.audio_root = audio_root
        self.label_encoder = label_encoder
        self.augment = augment
        self.noise_probability = noise_probability

    def __len__(self) -> int:
        return len(self.frame)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        row = self.frame.iloc[index]
        audio_path = self.audio_root / row["path"]
        waveform, sample_rate = torchaudio.load(audio_path)
        waveform = waveform.mean(dim=0).numpy()

        if sample_rate != SAMPLE_RATE:
            waveform = librosa.resample(waveform, orig_sr=sample_rate, target_sr=SAMPLE_RATE)

        waveform = pad_or_trim(waveform, SAMPLE_RATE * 2)
        if self.augment:
            waveform = augment_waveform(waveform, self.noise_probability)

        mel = librosa.feature.melspectrogram(
            y=waveform,
            sr=SAMPLE_RATE,
            n_fft=N_FFT,
            hop_length=HOP_LENGTH,
            n_mels=N_MELS,
            fmin=60,
            fmax=5000,
        )
        log_mel = librosa.power_to_db(mel, ref=np.max)
        log_mel = (log_mel + 80.0) / 80.0
        label = self.label_encoder.transform([row["label"]])[0]

        return torch.tensor(log_mel, dtype=torch.float32).unsqueeze(0), torch.tensor(label)


class CnnRecognizer(nn.Module):
    def __init__(self, class_count: int) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)),
        )
        self.classifier = nn.Linear(128, class_count)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.features(x).flatten(1))


class CrnnRecognizer(nn.Module):
    def __init__(self, class_count: int) -> None:
        super().__init__()
        self.cnn = nn.Sequential(
            nn.Conv2d(1, 48, kernel_size=3, padding=1),
            nn.BatchNorm2d(48),
            nn.ReLU(),
            nn.MaxPool2d((2, 1)),
            nn.Conv2d(48, 96, kernel_size=3, padding=1),
            nn.BatchNorm2d(96),
            nn.ReLU(),
            nn.MaxPool2d((2, 1)),
        )
        self.gru = nn.GRU(96 * (N_MELS // 4), 128, num_layers=2, batch_first=True, bidirectional=True)
        self.classifier = nn.Linear(256, class_count)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.cnn(x)
        batch, channels, mel_bins, frames = features.shape
        sequence = features.permute(0, 3, 1, 2).reshape(batch, frames, channels * mel_bins)
        output, _ = self.gru(sequence)
        return self.classifier(output.mean(dim=1))


class TransformerRecognizer(nn.Module):
    def __init__(self, class_count: int) -> None:
        super().__init__()
        self.projection = nn.Linear(N_MELS, 128)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=128,
            nhead=4,
            dim_feedforward=256,
            batch_first=True,
            dropout=0.1,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=4)
        self.classifier = nn.Linear(128, class_count)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        sequence = x.squeeze(1).transpose(1, 2)
        encoded = self.encoder(self.projection(sequence))
        return self.classifier(encoded.mean(dim=1))


def pad_or_trim(waveform: np.ndarray, length: int) -> np.ndarray:
    if waveform.shape[0] >= length:
        return waveform[:length]
    return np.pad(waveform, (0, length - waveform.shape[0]))


def augment_waveform(waveform: np.ndarray, noise_probability: float) -> np.ndarray:
    output = waveform.copy()
    if np.random.random() < noise_probability:
        noise = np.random.normal(0, np.random.uniform(0.002, 0.02), size=output.shape)
        output = output + noise
    if np.random.random() < 0.35:
        semitones = np.random.uniform(-0.25, 0.25)
        output = librosa.effects.pitch_shift(output, sr=SAMPLE_RATE, n_steps=semitones)
    return np.clip(output, -1, 1)


def build_model(name: str, class_count: int) -> nn.Module:
    if name == "cnn":
        return CnnRecognizer(class_count)
    if name == "crnn":
        return CrnnRecognizer(class_count)
    if name == "transformer":
        return TransformerRecognizer(class_count)
    raise ValueError(f"Unknown model: {name}")


def train(config: TrainingConfig) -> None:
    metadata = pd.read_csv(config.metadata)
    label_encoder = LabelEncoder().fit(metadata["label"])
    train_frame = metadata[metadata["split"] == "train"]
    val_frame = metadata[metadata["split"] == "val"]

    train_loader = DataLoader(
        GuitarDataset(train_frame, config.audio_root, label_encoder, True, config.noise_probability),
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=2,
    )
    val_loader = DataLoader(
        GuitarDataset(val_frame, config.audio_root, label_encoder, False, 0),
        batch_size=config.batch_size,
        shuffle=False,
        num_workers=2,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_model(config.model, len(label_encoder.classes_)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=1e-4)

    for epoch in range(config.epochs):
        model.train()
        train_loss = 0.0
        for features, labels in train_loader:
            features = features.to(device)
            labels = labels.to(device)
            optimizer.zero_grad()
            logits = model(features)
            loss = F.cross_entropy(logits, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()

        predictions, targets = evaluate(model, val_loader, device)
        print(f"epoch={epoch + 1} train_loss={train_loss / max(1, len(train_loader)):.4f}")
        print(classification_report(targets, predictions, target_names=label_encoder.classes_, zero_division=0))

    output_dir = Path("artifacts/musicau")
    output_dir.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state": model.state_dict(),
            "classes": label_encoder.classes_.tolist(),
            "model": config.model,
        },
        output_dir / f"{config.model}.pt",
    )


def evaluate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
) -> tuple[list[int], list[int]]:
    model.eval()
    predictions: list[int] = []
    targets: list[int] = []
    with torch.no_grad():
        for features, labels in loader:
            logits = model(features.to(device))
            predictions.extend(logits.argmax(dim=1).cpu().tolist())
            targets.extend(labels.tolist())
    return predictions, targets


def parse_args() -> TrainingConfig:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--audio-root", type=Path, required=True)
    parser.add_argument("--model", choices=["cnn", "crnn", "transformer"], default="cnn")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--noise-probability", type=float, default=0.65)
    args = parser.parse_args()
    return TrainingConfig(
        metadata=args.metadata,
        audio_root=args.audio_root,
        model=args.model,
        batch_size=args.batch_size,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        noise_probability=args.noise_probability,
    )


if __name__ == "__main__":
    train(parse_args())
