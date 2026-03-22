import torch
import torch.nn as nn


class RespiSoundCRNN(nn.Module):
    """
    CRNN trained in Colab: 2× Conv-BN-ReLU-MaxPool, dropout, 1-layer LSTM, linear head.
    Input: (batch, 1, 128, time) log-mel as produced by extract_features() in main.py.
    Output logits order matches CLASSES in main.py (LabelEncoder order).
    """

    def __init__(self, num_classes: int = 5):
        super().__init__()
        self.cnn = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d(2),
        )
        self.dropout = nn.Dropout(0.3)
        self.rnn = nn.LSTM(
            input_size=64 * 32,
            hidden_size=128,
            num_layers=1,
            batch_first=True,
        )
        self.fc = nn.Linear(128, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.cnn(x)
        b, c, f, t = x.size()
        x = x.permute(0, 3, 1, 2).contiguous().view(b, t, c * f)
        x = self.dropout(x)
        x, _ = self.rnn(x)
        x = x[:, -1, :]
        return self.fc(x)
