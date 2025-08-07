import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

interface setOptions {
    showRX?: boolean;
}

export class SerialTerminal {
    private static rxBuffer: string = '';
    private static currentLine: string = '';
    private static isLineInProgress: boolean = false;
    public static onConnect: ((serialPort: SerialPort) => void) | null = null;
    public static onDisconnect: (() => void) | null = null;
    private static terminal: vscode.Terminal | null = null;
    private static serialPort: SerialPort | null = null;
    private static inputBuffer: string = '';
    private static emitter: vscode.EventEmitter<string> | null = null;
    private static isSending: boolean = false;

    private static showRX: boolean = false;

    public static set(options: setOptions) {
        if (options.showRX !== undefined) {
            this.showRX = options.showRX;
        }
    }

    static create(portPath: string, baudRate: number): void {
        if (this.terminal) {
            this.terminal.show();
            return;
        }

        this.emitter = new vscode.EventEmitter<string>();

        this.terminal = vscode.window.createTerminal({
            name: `串口终端 - ${portPath}`,
            pty: {
                onDidWrite: this.emitter.event,
                open: () => {
                    this.connectSerialPort(portPath, baudRate);
                    this.emitter?.fire('\x1B[1;32m[Elena Watch 开发工具] 串口终端启动成功！\x1B[0m');
                    this.printPrompt();
                },
                close: () => this.disconnectSerialPort(),
                handleInput: (data: string) => this.handleUserInput(data)
            }
        });

        this.terminal.show();
    }

    private static printPrompt(): void {
        this.emitter?.fire('> ');
    }

    private static connectSerialPort(portPath: string, baudRate: number): void {
        this.serialPort = new SerialPort({ path: portPath, baudRate });


        this.serialPort.on('data', (data: Buffer) => {
            // 1. 将新数据追加到缓冲区
            this.rxBuffer += data.toString();

            // 2. 统一处理所有换行符（兼容\r\n和\n）
            let lineEndPos;
            while ((lineEndPos = this.findLineEnd(this.rxBuffer)) !== -1) {
                // 提取完整行内容（不含换行符）
                let lineContent = this.rxBuffer.substring(0, lineEndPos);
                // 跳过空行
                if (lineContent.trim().length > 0) {
                    // 如果有未完成的行，先完成它
                    if (this.isLineInProgress) {
                        this.currentLine += lineContent;
                        this.displayLine(this.currentLine, true);
                        this.currentLine = '';
                        this.isLineInProgress = false;
                    } else {
                        this.displayLine(lineContent, true);
                    }
                }
                // 移除已处理部分
                this.rxBuffer = this.rxBuffer.substring(lineEndPos + (this.rxBuffer[lineEndPos] === '\r' && this.rxBuffer[lineEndPos + 1] === '\n' ? 2 : 1));
            }

            // 3. 处理剩余的不完整数据（只缓冲，不显示）
            if (this.rxBuffer.length > 0 && this.rxBuffer.trim().length > 0) {
                if (!this.isLineInProgress) {
                    this.currentLine = this.rxBuffer;
                    this.isLineInProgress = true;
                } else {
                    this.currentLine += this.rxBuffer;
                }
            }
            this.rxBuffer = '';
        });


        this.serialPort.on('error', (err) => {
            this.emitter?.fire(`\r\n\x1B[31m[ERROR] ${err.message}\x1B[0m`);
            this.printPrompt();
        });

        // 物理拔出或串口关闭事件
        this.serialPort.on('close', () => {
            this.emitter?.fire(`\r\n\x1B[31m[INFO] 串口已物理断开或关闭\x1B[0m`);
            this.disconnectSerialPort();
        });

        // 连接成功事件
        if (SerialTerminal.onConnect) {
            SerialTerminal.onConnect(this.serialPort);
        }
    }
    /**
 * 查找行结束位置（兼容\r\n和\n）
 */
    private static findLineEnd(buffer: string): number {
        const crPos = buffer.indexOf('\r');
        const lfPos = buffer.indexOf('\n');

        if (crPos !== -1 && (lfPos === -1 || crPos < lfPos)) {
            // 优先处理\r\n组合
            if (buffer[crPos + 1] === '\n') {
                return crPos;
            }
            return crPos;
        }

        return lfPos;
    }

    /**
     * 显示一行内容
     */
    private static displayLine(content: string, complete: boolean, type: 'RX' | 'TX' = 'RX'): void {
        // 清除当前行
        this.emitter?.fire('\r\x1B[K');
        let line = content;
        if (type === 'RX' && this.showRX) {
            const timestamp = new Date().toLocaleTimeString();
            line = `\x1B[34m[${timestamp}][RX]\x1B[0m ${content}`;
        }
        if (type === 'TX') {
            const timestamp = new Date().toLocaleTimeString();
            line = `\x1B[32m[${timestamp}] [TX]\x1B[0m ${content}`;
        }
        this.emitter?.fire(line);
        if (complete) {
            this.emitter?.fire('\r\n');
            this.printPrompt();
        }
    }

    private static handleUserInput(data: string): void {
        if (this.isSending) return;
        // 回车键
        if (data.charCodeAt(0) === 13) {
            if (this.inputBuffer.length === 0) {
                this.printPrompt();
                return;
            }
            this.isSending = true;
            const command = this.inputBuffer;
            this.inputBuffer = '';
            this.sendToSerial(command + '\r\n', () => {
                this.displayLine(command, true, 'TX');
                this.isSending = false;
            });
        }
        // 退格键
        else if (data.charCodeAt(0) === 127) {
            if (this.inputBuffer.length > 0) {
                this.inputBuffer = this.inputBuffer.slice(0, -1);
                this.emitter?.fire('\b \b');
            }
        }
        // 普通字符
        else {
            this.inputBuffer += data;
            this.emitter?.fire(data);
        }
    }

    private static sendToSerial(data: string, callback: () => void): void {
        if (!this.serialPort?.writable) {
            callback();
            return;
        }

        this.serialPort.write(data, (err) => {
            if (err) {
                const timestamp = new Date().toLocaleTimeString();
                this.emitter?.fire(`\r\n\x1B[31m[${timestamp}] TX失败: ${err.message}\x1B[0m`);
            }
            callback();
        });
    }

    private static disconnectSerialPort(): void {
        this.serialPort?.close();
        this.serialPort = null;
        vscode.window.showInformationMessage('串口连接已断开');
        this.emitter?.dispose();
        this.terminal?.dispose();
        this.terminal = null;
        // 断开事件
        if (SerialTerminal.onDisconnect) {
            SerialTerminal.onDisconnect();
        }
    }

    public static isConnected(): boolean {
        return !!this.serialPort && this.serialPort.isOpen;
    }

    public static disconnect(): void {
        this.disconnectSerialPort();
    }
}