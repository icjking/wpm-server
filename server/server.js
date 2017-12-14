require('shelljs/global');
const chalk = require('chalk');
const io = require('socket.io').listen(3000);
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const _ = require('lodash');
const execSync = require('child_process').execSync;
const users = require('./db').users;
const cryptHelper = require('./cryptHelper');
const packageStr = require('./packageTemplate');

const node_modules = 'node_modules';
const downloadPath = path.resolve(__dirname, '../download');
fse.ensureDirSync(downloadPath); // 文件目录不存在则创建

const getUser = (username) => {
	return users.filter(user => username === user.username)[0] || {};
};

io.sockets.on('connection', (conn) => {
	let user = {};
	const loginValidate = (data) => {
		user = getUser(data.username);
		if (user.username !== data.username) {
			conn.emit('validation', '用户名错误');
			return true;
		}
		if (user.password !== data.password) {
			conn.emit('validation', '密码错误');
			return true;
		}
	};
	
	conn.on('login', function (data) {
		// console.log('client Request login: %s', JSON.stringify(data));
		if (loginValidate(data)) return;
		conn.emit('login_success', cryptHelper.encrypt(JSON.stringify(data)));
	});
	conn.on('data', function ({ authInfo, params }) {
		if (authInfo && params) {
			// console.log('client Request data: %s', data);
			// console.log('cryptoHelper.decrypt data: %s', cryptHelper.decrypt(authInfo));
			const jsonData = JSON.parse(cryptHelper.decrypt(authInfo));
			if (loginValidate(jsonData)) return;
			handleCommand(conn, params, user.username);
		}
	});
	conn.on('disconnect', function () {
		console.log('socket disconnect username: %s', user.username);
	});
});

const handleCommand = (conn, params, username) => {
	let result = '';
	const userPath = path.resolve(downloadPath, username);
	const watchPath = path.resolve(userPath, node_modules);
	
	return Promise.resolve()
	.then(() => global.rm('-Rf', userPath))
	.then(() => global.mkdir(userPath))
	.then(() => global.mkdir(watchPath))
	.then(() => fs.writeFileSync(path.resolve(userPath, 'package.json'), JSON.stringify(packageStr, null, 4)))
	.then(() => global.cd(userPath))
	.then(() => {
		if (params.command.toLowerCase() !== 'login') {
			console.log(`npm ${params.command}`);
			result = execSync(`npm ${params.command}`).toString();
		}
	})
	.then(() => {
		// 获得当前文件夹下的所有的文件夹和文件
		const files = getAllFiles(watchPath);
		for (const filePath of files) {
			sendDataToClient(conn, filePath, params.node_modules_path);
		}
		if (files.length) {
			global.rm('-Rf', userPath);
			conn.emit('result', result);
		}
	})
	// error catch
	.catch(e => {
		global.echo(chalk.red('Build failed. See below for errors.\n'));
		global.echo(chalk.red(e.stack));
		process.exit(1);
	});
};

const sendDataToClient = (conn, filePath, node_modules_path) => {
	let data = fs.readFileSync(filePath, 'binary'); // 兼容图片等格式
	const tmpArr = filePath.split(node_modules);
	tmpArr[0] = node_modules_path + '/';
	let resPath = tmpArr.join(node_modules);
	conn.emit('data', { path: resPath, data: data });
};

/**
 * 获取文件夹下面的所有的文件(包括子文件夹)
 * @param {String} dir
 * @returns {Array}
 */
const getAllFiles = (dir) => {
	let AllFiles = [];
	const iteration = (dirPath) => {
		const [dirs, files] = _(fs.readdirSync(dirPath)).partition(p => fs.statSync(path.join(dirPath, p)).isDirectory());
		files.forEach(file => AllFiles.push(path.join(dirPath, file)));
		for (const _dir of dirs) {
			iteration(path.join(dirPath, _dir));
		}
	};
	iteration(dir);
	return AllFiles;
};