// Offline browser regression coverage. Chromium supplies synthetic cameras and microphones.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({ configFile: false, plugins: [vue()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
let browser
try {
  browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  })
  const page = await browser.newPage({ viewport: { width: 1250, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices
    const nativeCapture = devices.getUserMedia.bind(devices)
    const cameraOptions = [
      { kind: 'videoinput', deviceId: 'camera-a', label: '测试摄像头 A' },
      { kind: 'videoinput', deviceId: 'camera-b', label: '测试摄像头 B' },
    ]
    const qa = window.mediaQa = {
      list: [...cameraOptions, { kind: 'audioinput', deviceId: 'mic-a', label: '测试麦克风' },
        { kind: 'audioinput', deviceId: 'mic-b', label: '测试麦克风 B' },
        { kind: 'audiooutput', deviceId: 'speaker-a', label: '测试扬声器' }],
      streams: [], inputs: [], picks: [], constraints: [], sinks: [],
    }
    devices.enumerateDevices = async () => qa.list.slice()
    devices.getUserMedia = async constraints => {
      qa.inputs.push(constraints)
      if (qa.inputError) throw new DOMException('fixture', qa.inputError)
      if (qa.deferInput) await new Promise(resolve => { qa.resolveInput = resolve })
      const stream = await nativeCapture({ audio: !!constraints.audio, video: !!constraints.video })
      for (const track of stream.getTracks()) {
        const settings = track.getSettings.bind(track)
        const deviceId = (track.kind === 'audio' ? constraints.audio : constraints.video)?.deviceId?.exact
        if (deviceId) track.getSettings = () => ({ ...settings(), deviceId })
      }
      qa.streams.push(stream)
      return stream
    }
    devices.getDisplayMedia = async options => {
      qa.picks.push({ ...options, userGesture: navigator.userActivation.isActive })
      if (qa.displayError) throw new DOMException('fixture', qa.displayError)
      if (qa.deferDisplay) await new Promise(resolve => { qa.resolveDisplay = resolve })
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const pen = canvas.getContext('2d')
      pen.fillRect(0, 0, 1280, 720)
      const stream = canvas.captureStream(30)
      const track = stream.getVideoTracks()[0]
      const settings = { width: 1280, height: 720, frameRate: 30, displaySurface: qa.wrongSurface || options.video.displaySurface }
      track.getSettings = () => ({ ...settings })
      track.getCapabilities = () => ({ width: { min: 1, max: 1280 }, height: { min: 1, max: 720 }, frameRate: { min: 1, max: 30 } })
      track.applyConstraints = async value => {
        qa.constraints.push(value)
        settings.width = value.width?.max || 1280
        settings.height = value.height?.max || 720
        settings.frameRate = value.frameRate?.max || 30
      }
      qa.streams.push(stream)
      return stream
    }
    Object.defineProperty(HTMLMediaElement.prototype, 'sinkId', { configurable: true, get() { return this.testSink || '' } })
    HTMLMediaElement.prototype.setSinkId = async function (id) {
      qa.sinks.push(id)
      if (id && qa.rejectOutput) throw new DOMException('fixture', 'NotAllowedError')
      this.testSink = id
    }
    if (location.search.includes('unsupported')) {
      devices.getDisplayMedia = undefined
      delete HTMLMediaElement.prototype.setSinkId
    }
  })
  const url = `http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html`
  const mediaPage = () => page.getByRole('heading', { name: '音频与视频', exact: true })
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
  const videoSource = page.getByLabel('视频输入源')
  const preview = page.getByLabel('本地视频预览')
  const mic = page.locator('[data-setting-id="media-microphone"]')
  const speaker = page.locator('[data-setting-id="media-speaker"]')
  const search = page.getByRole('textbox', { name: '搜索设置与功能' })
  const allStopped = () => page.waitForFunction(() => window.mediaQa.streams.every(s => s.getTracks().every(t => t.readyState === 'ended')))
  const minimize = detail => page.evaluate(detail => window.dispatchEvent(new CustomEvent('yh-window-minimized', { detail })), detail)
  await page.goto(url)
  await page.waitForFunction(() => !!window.__qa)
  await page.evaluate(() => window.__qa.ctx.console.goto('/account'))
  await search.fill('虚拟摄像头')
  await page.getByRole('button', { name: /摄像头与桌面预览/ }).click()
  await mediaPage().waitFor()
  assert.equal(await page.evaluate(() => window.mediaQa.inputs.length + window.mediaQa.picks.length), 0)

  await page.getByLabel('输入设备').selectOption('mic-a')
  await page.evaluate(() => { window.mediaQa.inputError = 'NotAllowedError' })
  await button('测试麦克风').click()
  await mic.getByRole('status').filter({ hasText: '设备权限未获允许' }).waitFor()
  await page.evaluate(() => {
    window.mediaQa.reset = []
    navigator.permissions.query = async () => ({ state: 'denied' })
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      window.mediaQa.reset.push({ command, args })
      delete window.mediaQa.inputError
    } } }
  })
  await button('授权麦克风').click()
  await mic.getByText('麦克风已授权', { exact: true }).waitFor()
  await button('授权摄像头').click()
  await page.getByText('摄像头已授权', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.mediaQa.reset), [
    { command: 'reset_media_permission', args: { device: 'microphone' } },
    { command: 'reset_media_permission', args: { device: 'camera' } },
  ])
  await allStopped()
  await page.evaluate(() => { delete window.__TAURI__ })
  await page.evaluate(() => { window.mediaQa.inputError = 'NotReadableError' })
  await button('测试麦克风').click()
  await mic.getByRole('status').filter({ hasText: '正被占用' }).waitFor()
  await page.evaluate(() => { delete window.mediaQa.inputError })
  await button('测试麦克风').click()
  await page.waitForFunction(() => Number(document.querySelector('meter').value) > 0)
  await button('开始试录').click()
  await page.waitForTimeout(240)
  await button('结束录音').click()
  await button('试听录音').click()
  await page.waitForFunction(() => document.querySelector('.settings-page audio').currentTime > 0)
  await button('停止测试').click()
  await allStopped()
  assert.equal(await page.evaluate(() => window.mediaQa.inputs.at(-1).audio.deviceId.exact), 'mic-a')
  console.log('PASS: microphone selection, denied/busy errors, actual synthetic input level, recording and playback')

  await videoSource.selectOption('camera-a')
  await button('开启预览').click()
  await page.waitForFunction(() => document.querySelector('.device-preview video')?.videoWidth > 0)
  await videoSource.selectOption('camera-b')
  await page.waitForFunction(() => window.mediaQa.streams.at(-1).getVideoTracks()[0]?.getSettings().deviceId === 'camera-b')
  assert.equal(await page.evaluate(() => window.mediaQa.streams.at(-2).getVideoTracks()[0].readyState), 'ended')
  await page.evaluate(() => {
    window.mediaQa.list = window.mediaQa.list.filter(d => d.deviceId !== 'camera-b')
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  })
  await page.getByRole('status').filter({ hasText: '摄像头已断开' }).waitFor()
  await allStopped()
  await button('开启预览').click()
  await page.waitForFunction(() => document.querySelector('.device-preview video')?.videoWidth > 0)
  assert.equal(await page.evaluate(() => window.mediaQa.inputs.at(-1).video), true)
  await minimize(true)
  await allStopped()
  await minimize(false)
  await preview.waitFor({ state: 'hidden' })
  await button('开启预览').click()
  await preview.waitFor()
  await button('测试麦克风').click()
  await button('停止测试').waitFor()
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await allStopped()
  await preview.waitFor({ state: 'hidden' })
  console.log('PASS: camera switching releases the old stream, unplug falls back, minimize releases capture')

  await page.getByLabel('输出设备').selectOption('speaker-a')
  await button('播放测试音').click()
  await page.waitForFunction(() => window.mediaQa.sinks.includes('speaker-a') && document.querySelector('.settings-page audio').currentTime > 0)
  await button('播放测试音').waitFor()
  await page.evaluate(() => {
    document.querySelector('.settings-page audio').testSink = ''
    window.mediaQa.rejectOutput = true
  })
  await button('播放测试音').click()
  await speaker.getByRole('status').filter({ hasText: '正在使用系统默认输出' }).waitFor()
  await button('播放测试音').waitFor()
  console.log('PASS: speaker routing and permission fallback')

  await page.evaluate(() => { window.mediaQa.displayError = 'NotAllowedError' })
  await videoSource.selectOption('monitor')
  await page.getByRole('status').filter({ hasText: '未授权桌面采集' }).waitFor()
  await page.evaluate(() => { delete window.mediaQa.displayError; window.mediaQa.wrongSurface = 'monitor' })
  await videoSource.selectOption('window')
  await page.getByRole('status').filter({ hasText: '请选择应用窗口' }).waitFor()
  await allStopped()
  await page.evaluate(() => { delete window.mediaQa.wrongSurface })
  await button('选择屏幕或窗口').click()
  await preview.waitFor()
  await page.getByLabel('分辨率上限').selectOption('960x540')
  await page.getByLabel('帧率上限').selectOption('15')
  assert.equal(await page.getByLabel('帧率上限').locator('option[value="60"]').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.mediaQa.constraints.at(-1)), { width: { max: 960 }, height: { max: 540 }, frameRate: { max: 15 } })
  assert.ok(await page.evaluate(() => window.mediaQa.picks.every(p => p.audio === false && p.userGesture)))
  await button('切换采集来源').click()
  await preview.waitFor()
  await page.evaluate(() => {
    const track = window.mediaQa.streams.at(-1).getVideoTracks()[0]
    track.stop()
    track.dispatchEvent(new Event('ended'))
  })
  await page.getByRole('status').filter({ hasText: '桌面采集已停止' }).waitFor()
  await allStopped()
  console.log('PASS: desktop picker gesture, denied permission, window/monitor validation, supported limits, switching and OS stop')

  await page.evaluate(() => { window.mediaQa.deferDisplay = true })
  await button('选择屏幕或窗口').click()
  await page.waitForFunction(() => !!window.mediaQa.resolveDisplay)
  await search.fill('扬声器')
  const beforeDisplayGrant = await page.evaluate(() => window.mediaQa.streams.length)
  await page.evaluate(() => window.mediaQa.resolveDisplay())
  await page.waitForFunction(count => window.mediaQa.streams.length > count, beforeDisplayGrant)
  await allStopped()
  await search.clear()
  await preview.waitFor({ state: 'hidden' })
  await page.evaluate(() => { window.mediaQa.deferInput = true })
  await button('测试麦克风').click()
  await page.waitForFunction(() => !!window.mediaQa.resolveInput)
  await page.evaluate(() => window.__qa.ctx.console.goto('/'))
  const beforeInputGrant = await page.evaluate(() => window.mediaQa.streams.length)
  await page.evaluate(() => window.mediaQa.resolveInput())
  await page.waitForFunction(count => window.mediaQa.streams.length > count, beforeInputGrant)
  await allStopped()
  console.log('PASS: late grants are discarded on settings search and navigation away')

  await page.reload()
  await page.waitForFunction(() => !!window.__qa)
  await page.evaluate(() => window.__qa.ctx.console.goto('/account'))
  await button('音频与视频').click()
  await mediaPage().waitFor()
  assert.equal(await page.getByLabel('输入设备').inputValue(), 'mic-a')
  assert.equal(await videoSource.inputValue(), 'camera-b')
  assert.equal(await page.getByLabel('输出设备').inputValue(), 'speaker-a')
  assert.equal(await page.evaluate(() => window.mediaQa.streams.length), 0)
  for (const mode of ['dark', 'light']) {
    await page.evaluate(mode => { document.documentElement.dataset.theme = mode }, mode)
    await page.setViewportSize({ width: mode === 'dark' ? 1250 : 470, height: 650 })
    const grid = page.locator('.device-grid')
    assert.equal(await grid.evaluate(e => e.scrollWidth <= e.clientWidth), true)
    const contrast = await grid.locator('.device-card').first().evaluate(card => {
      const luminance = value => {
        const channels = value.match(/[0-9.]+/g).slice(0, 3).map(n => Number(n) / 255)
        const [r, g, b] = channels.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        return .2126 * r + .7152 * g + .0722 * b
      }
      const text = luminance(getComputedStyle(card.querySelector('header p')).color)
      const bg = luminance(getComputedStyle(card).backgroundColor)
      return (Math.max(text, bg) + .05) / (Math.min(text, bg) + .05)
    })
    assert.ok(contrast >= 4.5, `${mode} contrast ${contrast}`)
  }
  await page.evaluate(() => {
    window.__qa.ctx.chat.open({ id: 'private-qa', name: '离线私聊', type: 1 })
    window.__qa.ctx.console.goto('/')
  })
  await page.locator('.chat-header').getByText('离线私聊', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /发起(语音|视频)通话/ }).count(), 0)
  console.log('PASS: persisted preferences, no auto-capture, responsive dark/light layout and no exposed call controls')
  await page.goto(url + '?unsupported')
  await page.waitForFunction(() => !!window.__qa)
  await page.evaluate(() => window.__qa.ctx.console.goto('/account'))
  await button('音频与视频').click()
  await mediaPage().waitFor()
  assert.ok(await page.getByLabel('输出设备').isDisabled())
  assert.equal(await videoSource.locator('option[value="window"]').evaluate(option => option.disabled), true)
  await page.getByText('当前 WebView 或浏览器不支持桌面采集。').waitFor()
  await button('播放测试音').click()
  await page.waitForFunction(() => document.querySelector('.settings-page audio').currentTime > 0)
  assert.deepEqual(errors, [])
  console.log('PASS: unavailable screen capture and output selection degrade to working default audio')
} finally {
  await browser?.close()
  await server.close()
}
