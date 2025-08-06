# Elena Watch Development Tools

用于 Elena Watch 开发的工具集，基于 VSCode 插件。

## Features

目前的功能：

- [x] 串口收发
- [x] YMODEM协议传输文件（仅发送）

## 环境需求

您需要安装以下模块：
```
npm install serialport @serialport/parser-readline --save
npm install path-browserify @types/node -save-dev
```
## 使用方法

安装插件后左下角会显示一个按钮“连接到 Elena Watch ”，按下按钮后配置串口号和波特率以便串口连接。
连接成功后，自动弹出串口终端，可以用于发送数据或接收数据。
当串口连接成功时，出现“发送当前文件”按钮，按下按钮后，可以选择要发送的文件，选择后将会使用YMODEM协议通过串口发送文件。

**Enjoy!**
