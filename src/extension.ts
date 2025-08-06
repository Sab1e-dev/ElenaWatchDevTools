import * as vscode from 'vscode';
import { SerialPort } from 'serialport';
import { SerialTerminal } from './SerialTerminalProvider';
import { transfer, SerialPortLike } from './ymodem';
import * as path from 'path';

let serialPort: SerialPort | null = null;
export let outputChannel: vscode.OutputChannel;
let connectStatusBarItem: vscode.StatusBarItem;
let sendFileStatusBarItem: vscode.StatusBarItem;

function createSerialPortWrapper(port: SerialPort): SerialPortLike {
    return {
        write: (data: Buffer | Uint8Array) => new Promise((resolve, reject) => {
            port.write(data, (err) => err ? reject(err) : resolve());
        }),
        on: (event: string, callback: (data: Buffer) => void) => {
            port.on('data', callback);
        },
        removeListener: (event: string, callback: (data: Buffer) => void) => {
            port.off('data', callback);
        },
        isOpen: port.isOpen
    };
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Serial Port Monitor');
    context.subscriptions.push(outputChannel);

    // 状态栏按钮初始化
    connectStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    connectStatusBarItem.text = '$(elena-watch)  连接到 Elena Watch';
    connectStatusBarItem.tooltip = '连接串口';
    connectStatusBarItem.command = 'ewdt.serial.createTerminal';
    connectStatusBarItem.show();
    context.subscriptions.push(connectStatusBarItem);

    sendFileStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        101
    )
    sendFileStatusBarItem.text = '$(file-symlink-file) 发送文件'
    sendFileStatusBarItem.tooltip = '使用YMODEM协议通过串口发送文件到设备';
    sendFileStatusBarItem.command = 'ewdt.serial.sendFile';

    // 连接事件：修改按钮为断开
    SerialTerminal.onConnect = (onConnectSerialPort: SerialPort) => {
        connectStatusBarItem.text = '$(debug-disconnect) 断开 Elena Watch';
        connectStatusBarItem.tooltip = '断开串口';
        connectStatusBarItem.command = 'ewdt.serial.disconnectTerminal';
        serialPort = onConnectSerialPort; // 保存当前串口实例
        sendFileStatusBarItem.show();
    };
    // 断开事件：修改按钮为连接
    SerialTerminal.onDisconnect = () => {
        connectStatusBarItem.text = '$(elena-watch)  连接到 Elena Watch';
        connectStatusBarItem.tooltip = '连接串口';
        connectStatusBarItem.command = 'ewdt.serial.createTerminal';
        sendFileStatusBarItem.hide();
        serialPort = null; // 清除当前串口实例
    };

    // 创建串口终端命令
    const createTerminalHandler = async () => {
        if (SerialTerminal.isConnected()) {
            vscode.window.showWarningMessage('串口已连接！');
            return;
        }
        try {
            const ports = await SerialPort.list();
            const selectedPort = await vscode.window.showQuickPick(
                ports.map(port => ({
                    label: port.path,
                    description: port.manufacturer || 'Unknown',
                    detail: `PID: ${port.productId || 'N/A'}, VID: ${port.vendorId || 'N/A'}`
                })),
                { placeHolder: 'Select a serial port...' }
            );

            if (!selectedPort) return;

            const baudRate = await vscode.window.showInputBox({
                prompt: 'Enter baud rate (e.g., 9600, 115200)',
                value: '115200'
            });

            if (!baudRate) return;

            SerialTerminal.create(selectedPort.label, parseInt(baudRate));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create serial terminal: ${error}`);
        }
    };

    // 断开串口命令
    const disconnectTerminalHandler = () => {
        if (SerialTerminal.isConnected()) {
            SerialTerminal.disconnect();
        } else {
            vscode.window.showWarningMessage('串口未连接！');
        }
    };

    const sendFileHandler = async () => {
        if (!serialPort?.isOpen) {
            vscode.window.showErrorMessage('请先连接串口！');
            return;
        }

        // 获取当前活动文件和所有已打开文件
        const activeEditor = vscode.window.activeTextEditor;
        const activeFile = activeEditor?.document.uri;



        // 获取所有标签页文件（包括未聚焦的）
        const allTabFiles = vscode.window.tabGroups.all.flatMap(group =>
            group.tabs
                .filter(tab => tab.input instanceof vscode.TabInputText)
                .map(tab => (tab.input as vscode.TabInputText).uri)
                .filter(uri => uri.scheme === 'file')
        );

        // 去重并排除活动文件
        const uniqueFiles = Array.from(new Set(allTabFiles.map(uri => uri.fsPath)))
            .map(fsPath => vscode.Uri.file(fsPath))
            .filter(uri => activeFile ? uri.fsPath !== activeFile.fsPath : true);

        // 构造 QuickPick 选项
        const quickPickItems: vscode.QuickPickItem[] = [];
        if (activeFile) {
            quickPickItems.push({
                label: `当前文件: ${path.basename(activeFile.fsPath)}`,
                description: activeFile.fsPath,
                detail: '正在编辑的文件'
            });
        }
        quickPickItems.push({
            label: '选择其他文件...',
            description: '',
            detail: '从文件系统选择'
        });
        for (const uri of uniqueFiles) {
            quickPickItems.push({
                label: `已打开: ${path.basename(uri.fsPath)}`,
                description: uri.fsPath,
                detail: '已打开但非焦点文件'
            });
        }

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: '选择要发送的文件'
        });
        if (!selected) return;

        let fileUri: vscode.Uri | undefined;
        if (selected.label === '选择其他文件...') {
            const fileDialog = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                openLabel: '选择要发送的文件'
            });
            if (!fileDialog?.[0]) return;
            fileUri = fileDialog[0];
        } else {
            fileUri = vscode.Uri.file(selected.description!);
        }

        try {
            const filePath = fileUri.fsPath;
            const fileData = await vscode.workspace.fs.readFile(fileUri);

            outputChannel.show();
            outputChannel.appendLine(`准备发送文件: ${filePath}`);

            const serialWrapper = createSerialPortWrapper(serialPort);

            const logger = (msg: string) => outputChannel.appendLine(msg);
            const onProgress = ([current, total]: [number, number]) => {
                vscode.window.setStatusBarMessage(`YMODEM 进度: ${current}/${total} 包`, 2000);
            };

            await transfer(
                serialWrapper,
                path.basename(filePath),
                Buffer.from(fileData),
                onProgress,
                logger
            );

            vscode.window.showInformationMessage('文件发送成功！');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`[ERROR] ${msg}`);
            vscode.window.showErrorMessage(`文件发送失败: ${msg}`);
        }
    }

    context.subscriptions.push(vscode.commands.registerCommand('ewdt.serial.createTerminal', createTerminalHandler));
    context.subscriptions.push(vscode.commands.registerCommand('ewdt.serial.disconnectTerminal', disconnectTerminalHandler));
    context.subscriptions.push(vscode.commands.registerCommand('ewdt.serial.sendFile', sendFileHandler));
}

export function deactivate() {
    if (serialPort?.isOpen) {
        serialPort.close();
    }
}
