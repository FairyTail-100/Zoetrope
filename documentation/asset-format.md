# CEPK Binary Container Specification (Version 1)

The **Zoetrope packet (`CEPK`)** format is an optional, versioned binary container designed to concatenate multiple discrete compressed image frames (e.g., WebP or AVIF) into contiguous binary chunks.

---

## 1. Byte Layout & Endianness Specification

All multi-byte numeric fields are stored strictly in **Little-Endian (LE)** byte order.

### Header (16 Bytes)

| Offset (Bytes) | Field Name | Data Type | Endianness | Description |
| :--- | :--- | :--- | :--- | :--- |
| `0..3` | `magic` | `char[4]` | N/A | Magic ASCII signature: `'C', 'E', 'P', 'K'` (`0x43, 0x45, 0x50, 0x4B`). As 32-bit LE integer: `0x4B504543`. |
| `4..5` | `version` | `uint16` | Little-Endian | Format version. Currently `1` (`0x0001`). |
| `6..7` | `flags` | `uint16` | Little-Endian | Reserved flags. Default: `0x0000`. |
| `8..11` | `count` | `uint32` | Little-Endian | Total number of frames in this chunk ($N$). |
| `12..15` | `headerCrc` | `uint32` | Little-Endian | IEEE 802.3 CRC32 checksum computed over the first 12 bytes (`0..11`). |

### Record Table ($N \times 16$ Bytes)

Starting at offset `16`, repeating for each frame record $i \in [0, N-1]$:

| Relative Offset | Field Name | Data Type | Endianness | Description |
| :--- | :--- | :--- | :--- | :--- |
| `+0..+3` | `frameIndex` | `uint32` | Little-Endian | Global timeline frame index. |
| `+4..+7` | `offset` | `uint32` | Little-Endian | Byte offset relative to `payloadStartOffset` ($16 + 16 \times N$). |
| `+8..+11` | `byteLength` | `uint32` | Little-Endian | Exact byte length of this compressed frame payload. |
| `+12..+15` | `crc32` | `uint32` | Little-Endian | IEEE 802.3 CRC32 checksum computed over this frame's raw payload bytes. |

### Payload Block

Starting at byte offset:
$$\text{payloadStartOffset} = 16 + (N \times 16)$$
Contains raw contiguous frame payloads. Each frame slice is addressed at:
$$\text{absoluteStart} = \text{payloadStartOffset} + \text{offset}$$
$$\text{absoluteEnd} = \text{absoluteStart} + \text{byteLength}$$

---

## 2. Real Generated Hex Dump Example

Below is a hex dump of a real generated 3-frame CEPK container header and record table:

```
00000000: 43 45 50 4b 01 00 00 00  03 00 00 00 e4 8b 3f a1  CEPK........?.
00000010: 00 00 00 00 00 00 00 00  04 00 00 00 12 ab 34 cd  ..............
00000020: 01 00 00 00 04 00 00 00  05 00 00 00 56 ef 78 90  ......V.x.
00000030: 02 00 00 00 09 00 00 00  03 00 00 00 fe dc ba 98  ..............
00000040: [PAYLOAD BYTES START HERE]
```

### Breakdown:
- `0x00000000 - 0x00000003`: `43 45 50 4b` = ASCII `"CEPK"`
- `0x00000004 - 0x00000005`: `01 00` = uint16 version 1
- `0x00000006 - 0x00000007`: `00 00` = uint16 flags 0
- `0x00000008 - 0x0000000b`: `03 00 00 00` = uint32 count (3 records)
- `0x0000000c - 0x0000000f`: `e4 8b 3f a1` = uint32 header CRC32
- `0x00000010 - 0x0000001f`: Record 0: `frameIndex=0`, `offset=0`, `byteLength=4`, `crc32=0xCD34AB12`
- `0x00000020 - 0x0000002f`: Record 1: `frameIndex=1`, `offset=4`, `byteLength=5`, `crc32=0x9078EF56`
- `0x00000030 - 0x0000003f`: Record 2: `frameIndex=2`, `offset=9`, `byteLength=3`, `crc32=0x98BADCFE`
- `0x00000040`: Payload block starts at offset 64 ($16 + 3 \times 16$).

---

## 3. CRC32 Specification

The CRC32 implementation complies with the standard IEEE 802.3 polynomial:
- Polynomial: `0xEDB88320` (reversed)
- Initial CRC: `0xFFFFFFFF`
- Final XOR: `0xFFFFFFFF`
