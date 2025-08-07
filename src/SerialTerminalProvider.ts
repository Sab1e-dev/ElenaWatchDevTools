import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

export class SerialTerminal {
    public static onConnect: ((serialPort: SerialPort) => void) | null = null;
    public static onDisconnect: (() => void) | null = null;
    private static terminal: vscode.Terminal | null = null;
    private static serialPort: SerialPort | null = null;
    private static inputBuffer: string = '';
    private static emitter: vscode.EventEmitter<string> | null = null;
    private static isSending: boolean = false;

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
        this.emitter?.fire('\r\n> ');
    }

    private static connectSerialPort(portPath: string, baudRate: number): void {
        this.serialPort = new SerialPort({ path: portPath, baudRate });

        this.serialPort.on('data', (data: Buffer) => {
            const timestamp = new Date().toLocaleTimeString();
            this.emitter?.fire('\r\x1B[K');
            this.emitter?.fire(`\x1B[34m [${timestamp}] [RX]\x1B[0m ${data.toString().trim()}`);
            this.printPrompt();
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
                const timestamp = new Date().toLocaleTimeString();
                this.emitter?.fire(`\r\x1B[32m [${timestamp}] [TX]\x1B[0m ${command}`);
                this.isSending = false;
                this.printPrompt();
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