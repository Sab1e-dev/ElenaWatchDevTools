// YMODEM Constants
const SOH = 0x01; // Start of 128-byte packet
const STX = 0x02; // Start of 1024-byte packet
const EOT = 0x04; // End of transmission
const ACK = 0x06;
const NAK = 0x15;
const CA = 0x18;
const CRC16 = 0x43; // ASCII 'C'

const PACKET_SIZE_128 = 128;
const PACKET_SIZE_1024 = 1024;

// Type definitions
export interface SerialPortLike {
    write(data: Buffer | Uint8Array): Promise<void>;
    on(event: string, callback: (data: Buffer) => void): void;
    removeListener(event: string, callback: (data: Buffer) => void): void;
    isOpen?: boolean;
}

type ProgressCallback = (progress: [number, number]) => void;
type Logger = (msg: string) => void;

interface TransferResult {
    filePath: string;
    totalBytes: number;
    writtenBytes: number;
}

// Utils
function noop() { }

function crc16xmodem(buffer: Buffer, offset: number, length: number): number {
    let crc = 0;
    for (let i = 0; i < length; i++) {
        crc ^= buffer[offset + i] << 8;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    return crc & 0xFFFF;
}

function buildPacket(data: Buffer, blockNum: number, packetSize: number): Buffer {
    const header = Buffer.alloc(3);
    header[0] = packetSize === PACKET_SIZE_128 ? SOH : STX;
    header[1] = blockNum & 0xFF;
    header[2] = 0xFF - header[1];

    const payload = Buffer.alloc(packetSize, 0x1A); // Pad with 0x1A
    data.copy(payload, 0, 0, Math.min(data.length, packetSize));

    const crc = crc16xmodem(payload, 0, packetSize);
    const footer = Buffer.alloc(2);
    footer.writeUInt16BE(crc, 0);

    return Buffer.concat([header, payload, footer]);
}

function buildHeaderPacket(filename: string, filesize: number): Buffer {
    const payload = Buffer.alloc(PACKET_SIZE_128, 0x00);
    let idx = payload.write(filename);
    payload.write(`${filesize}`, idx + 1);

    const crc = crc16xmodem(payload, 0, PACKET_SIZE_128);
    const header = Buffer.from([SOH, 0x00, 0xFF]);
    const footer = Buffer.alloc(2);
    footer.writeUInt16BE(crc, 0);

    return Buffer.concat([header, payload, footer]);
}

function waitChar(serial: SerialPortLike, valid: number[], timeout = 10000): Promise<number> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            serial.removeListener("data", handler);
            reject(new Error("Timeout waiting for receiver"));
        }, timeout);

        const handler = (data: Buffer) => {
            const byte = data[0];
            if (valid.includes(byte)) {
                clearTimeout(timer);
                serial.removeListener("data", handler);
                resolve(byte);
            }
        };

        serial.on("data", handler);
    });
}

function splitFileToPackets(buffer: Buffer): Buffer[] {
    const packets: Buffer[] = [];
    const total = buffer.length;
    let block = 1;

    for (let offset = 0; offset < total; ) {
        const remaining = total - offset;
        const chunkSize = remaining <= PACKET_SIZE_128 ? PACKET_SIZE_128 : PACKET_SIZE_1024;
        const chunk = buffer.slice(offset, offset + chunkSize);
        const packet = buildPacket(chunk, block++, chunkSize);
        packets.push(packet);
        offset += chunkSize;
    }

    return packets;
}

// Main transfer function
export async function transfer(
    serial: SerialPortLike,
    filename: string,
    fileBuffer: Buffer | Uint8Array,
    onProgress: ProgressCallback = noop,
    logger: Logger = console.log
): Promise<TransferResult> {
    const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer.buffer);
    const packets = splitFileToPackets(buffer);
    const totalBytes = buffer.length;
    let writtenBytes = 0;

    const log = (msg: string) => logger(`[YMODEM] ${msg}`);

    // 清除旧监听
    if (typeof (serial as any).removeAllListeners === "function") {
        (serial as any).removeAllListeners("data");
    }

    log("[等待] 字符C");
    await waitChar(serial, [CRC16]);
    log("[发送] 第一帧");
    await serial.write(buildHeaderPacket(filename, totalBytes));
    log("[等待] ACK");
    await waitChar(serial, [ACK]);
    log("[等待] 字符C");
    await waitChar(serial, [CRC16]);
    log("开始传输数据包...");
    for (let i = 0; i < packets.length; i++) {
        const packet = packets[i];
        await serial.write(packet);
        await waitChar(serial, [ACK]);
        writtenBytes = Math.min((i + 1) * PACKET_SIZE_1024, totalBytes);
        onProgress([i + 1, packets.length]);
    }
    log("[发送] EOT");
    await serial.write(Buffer.from([EOT]));
    log("[等待] NAK");
    await waitChar(serial, [NAK]);
    log("[发送] EOT");
    await serial.write(Buffer.from([EOT]));
    log("[等待] ACK");
    await waitChar(serial, [ACK]);
    log("[等待] 字符C");
    await waitChar(serial, [CRC16]);
    log("[发送] 空数据包"); 
    // 目前仅支持发送一个文件，如果多个文件需要继续发送文件名称，而不是空数据包
    await serial.write(buildHeaderPacket('', 0));
    log("[等待] ACK");
    await waitChar(serial, [ACK]);

    log("✅ 传输完成。");

    return {
        filePath: filename,
        totalBytes,
        writtenBytes
    };
}
