const sql = require('./sql')
const config = require('./config')
const upload = require('multer')({ dest: config.tmpPath })
const appRoute = require('./app')
let uploadingTasks = {} // 上传中的任务。
const ProcessTask = require('./processTask')

function route (app) {
  // 根据 状态和 模块名 来搜索离线包列表。
  app.get('/admin/packlist', function (req, res) {
    let statesSetting = req.query.status
    let searchName = req.query.search
    let pageNum = req.query.page
    if (statesSetting === undefined || pageNum === undefined) {
      return res.json({error: '参数传递错误！！！'})
    }
    pageNum = parseInt(pageNum) - 1
    let states = [0, 1, 2]
    if (statesSetting) {
      states = statesSetting.split('')
    }
    sql.getPackageInfo(states, searchName, pageNum, (err, list, count) => {
      if (err) {
        console.log(err)
        res.json({error: err.message})
      } else {
        res.json({
          list: list,
          count: count
        })
      }
    })
  })
  // 暂停包
  app.post('/admin/stopPack', function (req, res) {
    let packId = req.body.id
    if (packId === undefined) {
      return res.json({error: '参数传递错误！！'})
    }
    packId = parseInt(packId)
    sql.stopPackage(packId, err => {
      if (err) {
        console.log(err)
        res.json({error: err.message})
      } else {
        res.json({})
        setTimeout(() => {
          // 如果修改了包的状态，则刷新app区数据.
          appRoute.refreshPackInfo()
        }, 100)
      }
    })
  })

  // check 前端上传包后，轮询以检测包是否完成上传。
  app.get('/admin/checkTask', function (req, res) {
    let taskID = req.query.taskID
    if (taskID === undefined) {
      return res.json({error: '参数传递错误!!'})
    }
    let packageInfo = uploadingTasks[taskID]
    if (!packageInfo) {
      res.json({ error: '未找到下载任务' })
    } else {
      res.json({
        taskProgress: packageInfo.taskProgress,
        taskState: packageInfo.taskState
      })
      if (packageInfo.taskProgress === 0) {
        // 如果进度为0，表示出错，删除本地任务
        uploadingTasks[taskID] = undefined
      } else if (packageInfo.taskProgress === 100) {
        // 任务完成，则也要删除任务
        setTimeout(() => {
          // 添加包成功，则刷新appRoute的状态
          appRoute.refreshPackInfo()
        }, 100)
        setTimeout(() => {
          uploadingTasks[taskID] = undefined
        }, 60000)
      }
    }
  })

  // 提交离线包, 创建任务
  app.post('/admin/pushPackInfo', function (req, res) {
    sql.getLastestPackageVersion(req.body.name, (err, lastestPacks) => {
      if (err) {
        res.json({ error: '数据库异常' })
      } else {
        let task = {...req.body}
        task.version = parseInt(task.version)
        task.download_time = parseInt(task.download_time)
        task.download_force = parseInt(task.download_force)
        let maxVersion = 0
        for (let version in lastestPacks) {
          version = parseInt(version)
          maxVersion = version > maxVersion ? version : maxVersion
        }
        if (req.body.version > maxVersion) {
          let taskName = req.body.name + req.body.version
          if (uploadingTasks[taskName]) {
            res.json({
              error: '当前该版本已有任务正在上传，请稍后刷新页面后再重新上传'
            })
            return
          }
          uploadingTasks[taskName] = task
          let appVersion = task['app_version']
          let splited = appVersion.split('.')
          task['app_version_code'] = parseInt(splited[0]) * 1000 * 1000 + parseInt(splited[1]) * 1000 + parseInt(splited[2])
          task['patch_urls'] = lastestPacks
          task['taskProgress'] = 10
          task['taskState'] = '等待上传包'
          task['taskID'] = taskName

          res.json({ taskID: taskName })
        } else {
          res.json({
            error:
              '版本号设置错误，请检测版本号，确保版本号唯一，且大于当前所有版本号'
          })
        }
      }
    })
  })

  app.post('/admin/uploadFile', upload.single('upload'), (req, res) => {
    // 没有附带文件
    if (!req.file) {
      res.json({ error: '未上传文件' })
    } else {
      // 开始上传与处理
      let packageInfo = uploadingTasks[req.query.taskID]
      if (packageInfo) {
        let task = new ProcessTask(packageInfo)
        packageInfo['filePath'] = req.file.path
        packageInfo['taskProgress'] = 20
        packageInfo['taskState'] = '包上传完成'
        res.json({})
        setTimeout(() => {
          task.start()
        })
        setTimeout(() => {
          // 删除本地任务记录。
          uploadingTasks[packageInfo.taskID] = undefined
        }, 3600000)
      } else {
        res.json({ error: '本地未找到任务， 上传出错！！' })
      }
    }
  })
}

module.exports = {
  router: route,
  path: '/admin'
}
