import torch
import torch.nn as nn


class RespiSoundCRNN(nn.Module):
    def __init__(self, num_classes=5, n_mels=128):
        super(RespiSoundCRNN, self).__init__()

        self.cnn = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=(3, 3), padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d((2, 2)),
            nn.Dropout2d(0.2),

            nn.Conv2d(32, 64, kernel_size=(3, 3), padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d((2, 2)),
            nn.Dropout2d(0.2),

            nn.Conv2d(64, 128, kernel_size=(3, 3), padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.MaxPool2d((2, 2)),
            nn.Dropout2d(0.3),

            nn.Conv2d(128, 256, kernel_size=(3, 3), padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((4, None)),
            nn.Dropout2d(0.3),
        )

        self.rnn = nn.GRU(
            input_size=256 * 4,
            hidden_size=128,
            num_layers=2,
            batch_first=True,
            bidirectional=True,
            dropout=0.3
        )

        self.attention = nn.Sequential(
            nn.Linear(256, 128),
            nn.Tanh(),
            nn.Linear(128, 1)
        )

        self.classifier = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(0.5),
            nn.Linear(128, num_classes)
        )

    def forward(self, x):
        cnn_out = self.cnn(x)

        batch, channels, freq, time = cnn_out.shape
        cnn_out = cnn_out.permute(0, 3, 1, 2)
        cnn_out = cnn_out.reshape(batch, time, channels * freq)

        rnn_out, _ = self.rnn(cnn_out)

        attn_weights = self.attention(rnn_out)
        attn_weights = torch.softmax(attn_weights, dim=1)
        context = (rnn_out * attn_weights).sum(dim=1)

        output = self.classifier(context)
        return output
