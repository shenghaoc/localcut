# ONNX DTLN model assets

Audio Cleanup uses ONNX Runtime Web on the WASM execution provider. The retained
manifest is `manifest.json`; there is no alternate cleanup runtime or model
picker.

## Shipped model

| Field          | Value                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| Model          | DTLN (Dual-Signal Transformation LSTM Network)                                             |
| Source         | [`breizhn/DTLN`](https://github.com/breizhn/DTLN)                                          |
| License        | MIT                                                                                        |
| Runtime        | ONNX Runtime Web, WASM EP                                                                  |
| Total size     | 3,968,247 bytes                                                                            |
| `model_1.onnx` | 1,458,237 bytes, `sha256-22b91cae3855e5a0620e66a917ca6c82c58db0e842c770f58d86751c5e8d4ae3` |
| `model_2.onnx` | 2,510,010 bytes, `sha256-e20c92f9233fccf29cddf86970d0d0161a03aebccc26d6f4d5639c4d5ec2e639` |

The manifest pins the upstream commit in each GitHub proxy URL and declares the
16 kHz mono DTLN audio contract (`blockLen: 512`, `blockShift: 128`) plus the
two recurrent state tensors.

## Fetch, verify, cache

The cleanup worker fetches the two ONNX files only after the user clicks
**Load model** or starts a cleanup action. Files are fetched through the
same-origin `/_model/gh/` proxy, verified by size and SHA-256, and cached in OPFS
by digest for offline reuse.

DTLN is not frame-coupled, so ORT-WASM with CPU tensors is the intended runtime
path. The editor never uploads audio and has no cloud fallback.
