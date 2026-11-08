// Cloud signaling is intercepted locally. Set YH_REAL_RTC=1 on a host that permits
// Chromium network-interface enumeration to exercise real ICE and media transport.
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
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--allow-loopback-in-peer-connection'],
  })
  const a = await browser.newPage({ viewport: { width: 1350, height: 830 } })
  const b = await browser.newPage({ viewport: { width: 1350, height: 830 } })
  await a.addInitScript(() => localStorage.setItem("yh.call.preview", "0"))
  const realRtc = process.env.YH_REAL_RTC === '1'
  const pages = { alpha: a, bravo: b }
  if (!realRtc) {
    for (const page of [a, b]) await page.addInitScript(() => {
      const media = navigator.mediaDevices
      const capture = media.getUserMedia.bind(media)
      media.enumerateDevices = async () => [
        { kind: 'audioinput', deviceId: 'mic-b', label: '测试麦克风' },
        { kind: 'videoinput', deviceId: 'cam-b', label: '测试摄像头' },
        { kind: 'audiooutput', deviceId: 'speaker-b', label: '测试扬声器' },
      ]
      media.getUserMedia = async constraints => {
        if (window.denyDevices) throw new DOMException('denied', 'NotAllowedError')
        const stream = await capture({ audio: !!constraints.audio, video: !!constraints.video })
        for (const track of stream.getTracks()) {
          const id = constraints[track.kind]?.deviceId?.exact
          if (id) {
            const settings = track.getSettings.bind(track)
            track.getSettings = () => ({ ...settings(), deviceId: id })
          }
        }
        return stream
      }
      media.getDisplayMedia = async constraints => {
        window.screenCaptureOptions = constraints
        if (window.denyScreen) throw new DOMException('cancelled', 'NotAllowedError')
        const stream = await capture({ video: true })
        const track = window.screenTrack = stream.getVideoTracks()[0]
        let settings = { width: 1920, height: 1080, frameRate: 30 }
        track.getSettings = () => settings
        track.applyConstraints = async constraints => {
          window.screenCaptureLimits = constraints
          const height = constraints.height?.ideal || 2160
          settings = { width: Math.round(height * 16 / 9), height, frameRate: Math.min(60, constraints.frameRate.ideal) }
        }
        return stream
      }
      Object.defineProperty(HTMLMediaElement.prototype, 'sinkId', { configurable: true, get() { return this.testSink || '' } })
      HTMLMediaElement.prototype.setSinkId = async function (id) { this.testSink = id }
      class TestPeer extends EventTarget {
        iceGatheringState = 'new'
        connectionState = 'new'
        senders = []
        transceivers = []
        candidates = []
        constructor(config) { super(); window.testPeer = this; this.config = config }
        addTrack(track) {
          const sender = {
            track, parameters: { encodings: [{}] },
            async replaceTrack(next) { this.track = next },
            getParameters() { return structuredClone(this.parameters) },
            async setParameters(parameters) { this.parameters = parameters },
          }
          this.senders.push(sender); return sender
        }
        getSenders() { return this.senders }
        addTransceiver(kind) {
          const sender = this.addTrack(null)
          const transceiver = { sender, receiver: { track: { kind } }, direction: 'recvonly' }
          this.transceivers.push(transceiver)
          return transceiver
        }
        getTransceivers() { return this.transceivers }
        async createOffer() { return this.description('offer') }
        async createAnswer() { return this.description('answer') }
        description(type) {
          return { type, sdp: 'v=0\r\n' }
        }
        async setLocalDescription(description) {
          this.localDescription = { ...description, toJSON: () => description }
          this.iceGatheringState = 'gathering'
          const candidate = { candidate: 'candidate:fixture', sdpMid: '0', sdpMLineIndex: 0 }
          this.onicecandidate?.({ candidate: { ...candidate, toJSON: () => candidate } })
          this.connect()
        }
        async setRemoteDescription(description) {
          this.remoteDescription = description
          if (description.type === 'offer' && window.denyDevices) {
            this.addTransceiver('audio')
            this.addTransceiver('video')
          }
          this.connect()
        }
        async addIceCandidate(candidate) {
          if (!this.remoteDescription) throw new Error('ICE candidate arrived before remote SDP')
          this.candidates.push(candidate)
          this.connect()
        }
        connect() {
          if (!this.localDescription || !this.remoteDescription || !this.candidates.length || this.connectionState !== 'new') return
          queueMicrotask(() => {
            if (this.connectionState !== 'new') return
            for (const { track } of this.senders) if (track) this.ontrack?.({ track: track.clone() })
            this.connectionState = 'connected'
            this.onconnectionstatechange?.()
          })
        }
        close() {
          this.connectionState = 'closed'
          if (window.testHangup) {
            window.testHangup.detached = [...document.querySelectorAll('.call-panel audio, .call-panel video')].every(media => !media.srcObject)
            throw new Error('Fixture: native RTC teardown failed')
          }
        }
      }
      window.RTCPeerConnection = TestPeer
    })
  }
  const errors = []
  const sent = [], groupRequests = []
  let holdFirstAnswer = !realRtc
  const answerAcknowledgement = Promise.withResolvers()
  const firstAnswerCandidate = Promise.withResolvers()
  let invitation
  let groupInvitation
  const reply = (route, data = {}) => route.fulfill({ json: { code: 1, data } })
  for (const [account, page] of Object.entries(pages)) {
    page.on('pageerror', error => errors.push(error.message))
    if (!realRtc) await page.route('**/src/core/group-call-room.ts*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `export function createGroupCallRoom(handlers) {
        const transport = window.groupTransport = {
          tracks: {}, connected: false, closed: false, updatePeers: handlers.peers
        };
        return {
          async connect(token) { transport.connected = true; transport.token = token; },
          setFeatured(id) { transport.featured = id },
          async tuneShare(profile) { transport.profile = profile },
          async replace(track, profile) {
            if (profile) transport.profile = profile;
            if (window.blockGroupReplacement) {
              window.pendingGroupTrack = track;
              await new Promise(resolve => { window.resumeGroupReplacement = resolve; });
            }
            transport.tracks[track.kind] = track;
            if (track.kind === 'video') handlers.peers([{ id: 'peer', name: '群通话测试成员',
              stream: new MediaStream([track.clone()]), hasVideo: true }]);
          },
          async removeVideo() { delete transport.tracks.video; handlers.peers([]); },
          close() {
            transport.detached = [...document.querySelectorAll('.call-panel audio, .call-panel video')].every(media => !media.srcObject);
            transport.closed = true;
          }
        };
      }`,
    }))
    await page.route('**/call-wire/**', async route => {
      const req = route.request()
      const path = new URL(req.url()).pathname.replace('/call-wire', '')
      assert.equal(req.headers().token, 'offline-' + account)
      if (path === '/v1/group/live-room') {
        const { groupId } = req.postDataJSON()
        return reply(route, { rooms: groupId === 'public-room-group'
          ? [{ roomId: 'public-voice-room', chatId: groupId, chatType: 2, status: 0, title: '进行中的语音房', nickname: '群成员', count: 3 }] : [] })
      }
      assert.equal(req.headers()['device-id'], 'test-' + account)
      if (path === '/v1/live/add') {
        assert.deepEqual(req.postDataJSON(), { roomId: 'public-voice-room', chatId: 'public-room-group' })
        return reply(route, { joinToken: 'offline-open-room' })
      }
      if (path === '/v1/live/get-calling') {
        if (groupInvitation?.peer === account) {
          const { room, type, from, chatId, invitees, title } = groupInvitation
          return reply(route, { chatType: 2, senderNickname: from,
            message: { msgId: room, chatId, senderId: from, contentType: type,
              content: JSON.stringify({ liveInviteUserIds: invitees, liveType: title }) } })
        }
        if (!invitation || invitation.peer !== account) return reply(route)
        const { room, type, form, peer, from } = invitation
        return reply(route, { chatType: 1, senderNickname: from,
          message: { msgId: room, senderId: from, contentType: type,
            content: JSON.stringify(JSON.stringify({ liveInviteUserIds: [peer], formJson: form })) } })
      }
      if (path === '/v1/msg/send-message') {
        assert.equal(req.headers()['content-type'], 'application/x-protobuf')
        const data = await page.evaluate(bytes => window.__qa.ctx.callFixture.decodeOffer(bytes), [...req.postDataBuffer()])
        if (data.chatType === 2) {
          assert.equal(req.headers().accept, 'application/x-protobuf')
          assert.equal(data.chatId, 'group-test')
          assert.equal(data.type, 12)
          assert.equal(data.title, '视频通话')
          assert.deepEqual(data.invitees, ['bravo'])
          assert.equal(data.form, null)
          groupInvitation = { ...data, from: account }
          groupRequests.push('start')
          const body = await page.evaluate(() => window.__qa.ctx.callFixture.groupResponse())
          await route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.from(body) })
          await b.evaluate(({ room, chatId, type, invitees, from }) => window.__qa.ctx.callFixture.groupPush(room, from, chatId, type, invitees), groupInvitation)
          return
        }
        assert.equal(data.chatType, 1)
        assert.equal(data.chatId, data.peer)
        assert.equal(data.form.type, 'offer')
        assert.ok(!data.form.sdp.includes('a=candidate:'), 'offer SDP uses separate ICE signaling')
        sent.push({ path, type: data.type, title: data.title })
        invitation = { ...data, from: account }
        await reply(route)
        await pages[data.peer].evaluate(({ room, from, type }) => window.__qa.ctx.callFixture.push(room, from, type), invitation)
        return
      }
      if (path === '/v1/file/candidate') {
        const { userId, deviceId, data } = req.postDataJSON()
        const candidate = JSON.parse(data)
        assert.equal(deviceId, '')
        assert.equal(candidate.did, null)
        assert.equal(candidate.from, account)
        assert.equal(candidate.to, userId)
        assert.equal(candidate.session_id, 'alpha-bravo')
        assert.match(candidate.candidate.candidate, /^candidate:/)
        assert.ok(candidate.candidate.sdpMid != null || candidate.candidate.sdpMLineIndex != null)
        await pages[userId].evaluate(({ account, data }) =>
          window.__qa.ctx.callFixture.candidate(account === 'alpha' ? 'candidate' : 'file_send_message', account, data),
        { account, data })
        if (account === 'bravo') firstAnswerCandidate.resolve()
        return reply(route)
      }
      const { roomId, selfId, rtcDescription } = req.postDataJSON()
      if (roomId === 'public-voice-room') {
        assert.equal(path, '/v1/live/hang_up')
        return reply(route)
      }
      if (roomId === groupInvitation?.room || roomId === 'official-group-invite') {
        groupRequests.push(path)
        if (path === '/v1/live/join') {
          assert.equal(selfId, '')
          assert.equal(rtcDescription, '')
          return reply(route, { joinToken: 'offline-group-guest' })
        }
        assert.equal(path, '/v1/live/hang_up')
        return reply(route)
      }
      assert.equal(roomId, invitation?.room)
      const target = account === invitation.from ? invitation.peer : invitation.from
      const action = path.split('/').at(-1)
      let event = action
      let answer
      if (action === 'join') {
        event = 'answer'
        assert.equal(selfId, '')
        answer = JSON.parse(rtcDescription)
        assert.equal(answer.type, 'answer')
        assert.ok(!answer.sdp.includes('a=candidate:'), 'answer SDP uses separate ICE signaling')
      }
      sent.push({ path })
      const forward = () => pages[target].evaluate(({ cmd, roomId, account, answer }) => window.__qa.ctx.callFixture.signal(cmd, roomId, account, answer),
        { cmd: 'live_video_user_' + event, roomId, account, answer })
      if (action === 'join' && holdFirstAnswer) {
        holdFirstAnswer = false
        await firstAnswerCandidate.promise
        assert.equal(await a.evaluate(() => window.testPeer.candidates.length), 0)
        await page.evaluate(room => window.__qa.ctx.callFixture.signal('live_video_user_handle', room, 'bravo'), roomId)
        await forward()
        await page.evaluate(() => window.testPeer.onconnectionstatechange())
        await answerAcknowledgement.promise
        return reply(route)
      }
      await reply(route)
      await forward()
      if (action !== 'join') invitation = null
    })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/ui-fixture/index.html?call-account=${account}`)
    await page.waitForFunction(() => !!window.__qa?.ctx.calls)
  }
  const panel = page => page.getByRole('region', { name: '私聊通话' })
  const button = (page, name) => page.getByRole('button', { name, exact: true })
  const callButton = (page, name) => page.locator('.composer-footer').getByRole('button', { name, exact: true })
  async function dragPanel(page, callPanel, dx, dy) {
    const title = callPanel.locator('header strong')
    const rect = await title.boundingBox()
    const x = rect.x + 10, y = rect.y + rect.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 8 })
    await page.mouse.up()
  }
  const open = (page, id, type = 1) => page.evaluate(async ({ id, type }) => {
    const { ctx } = window.__qa
    ctx.console.goto('/')
    await ctx.chat.open({ id, type, name: id })
  }, { id, type })
  await open(a, 'bravo')
  assert.equal(await callButton(a, '发起语音通话').count(), 1)
  assert.equal(await a.locator('.chat-header').getByRole('button', { name: '发起语音通话' }).count(), 0)
  await callButton(a, '发起语音通话').click()
  await button(a, '取消').click()
  assert.equal(sent.length, 0)
  await a.evaluate(() => window.__qa.ctx.console.goto('/account'))
  await button(a, '音频与视频').click()
  if (!realRtc) {
    await a.getByText('通话网络与中继', { exact: true }).click()
    await a.getByLabel('STUN 地址').fill('stun:stun.example.test:3478')
    await a.getByLabel('TURN 地址').fill('turns:turn.example.test:5349?transport=tcp')
    await a.getByLabel('TURN 用户名').fill('fixture-user')
    await a.getByLabel('TURN 密码').fill('fixture-secret')
    await button(a, '应用通话网络配置').click()
    await a.getByText('已应用到接下来的通话。', { exact: true }).waitFor()
    assert.equal(await a.evaluate(() => JSON.stringify(localStorage).includes('fixture-secret')), false)
  }
  await b.evaluate(() => window.__qa.ctx.calls.setEnabled(true))
  await open(a, 'bot-fixture', 3)
  assert.equal(await button(a, '发起语音通话').count(), 0)
  await open(a, 'bravo')
  await callButton(a, '发起语音通话').click()
  await button(a, '启用通话').click()
  await panel(b).getByRole('button', { name: '接听' }).click()
  for (const page of [a, b]) {
    await panel(page).getByRole('status').filter({ hasText: '语音通话 · 通话中' }).waitFor({ timeout: 15000 })
    await page.waitForFunction(() => {
      const audio = document.querySelector('.call-panel audio')
      return audio?.srcObject?.getAudioTracks().length === 1 && audio.currentTime > 0
    })
  }
  await panel(a).getByRole('button', { name: '静音' }).click()
  assert.equal(await a.evaluate(() => window.__qa.ctx.calls.state.local.getAudioTracks()[0].enabled), false)
  const track = await b.evaluateHandle(() => window.__qa.ctx.calls.state.local.getAudioTracks()[0])
  if (!realRtc) await b.evaluate(() => { window.testHangup = {} })
  try {
    await panel(b).getByRole('button', { name: '挂断' }).click()
    await panel(b).waitFor({ state: 'hidden', timeout: 2000 })
    await panel(a).waitFor({ state: 'hidden', timeout: 2000 })
    assert.equal(await track.evaluate(t => t.readyState), 'ended')
    if (!realRtc) assert.equal(await b.evaluate(() => window.testHangup.detached), true)
  } finally {
    answerAcknowledgement.resolve()
  }
  if (!realRtc) await b.evaluate(() => { delete window.testHangup })
  assert.equal(sent[0].type, 13)
  console.log(`PASS: ${realRtc ? 'real' : 'fixture'} two-endpoint audio with separate SDP/ICE, answer before HTTP acknowledgement, mute, hang-up and resource release`)

  await a.setViewportSize({ width: 950, height: 730 })
  await callButton(a, '发起视频通话').click()
  await panel(a).getByRole('status').filter({ hasText: '确认画面后发起呼叫' }).waitFor()
  await panel(a).evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
  const initialVideoPosition = await panel(a).boundingBox()
  await dragPanel(a, panel(a), -180, -100)
  const movedVideoPosition = await panel(a).boundingBox()
  assert.ok(Math.abs(movedVideoPosition.x - initialVideoPosition.x + 180) < 2)
  assert.ok(Math.abs(movedVideoPosition.y - initialVideoPosition.y + 100) < 2)
  await panel(a).getByRole('button', { name: '软件内全屏' }).click()
  await panel(a).getByRole('button', { name: '退出软件内全屏' }).click()
  assert.deepEqual(await panel(a).boundingBox(), movedVideoPosition)
  await a.setViewportSize({ width: 620, height: 520 })
  await a.waitForFunction(() => {
    const { right, bottom } = document.querySelector('.call-panel').getBoundingClientRect()
    return right <= innerWidth && bottom <= innerHeight
  })
  assert.equal(await panel(b).count(), 0)
  await panel(a).getByRole('button', { name: '发起视频通话' }).click()
  await panel(b).getByRole('button', { name: '接听' }).click()
  for (const page of [a, b]) {
    await panel(page).getByRole('status').filter({ hasText: '视频通话 · 通话中' }).waitFor({ timeout: 15000 })
    await page.waitForFunction(() => {
      const video = document.querySelector('.call-panel video[aria-label="对方画面"]')
      return video?.srcObject?.getAudioTracks().length === 1 && video?.videoWidth > 0
    })
  }
  await panel(a).getByRole('button', { name: '暂停画面' }).click()
  assert.equal(await a.evaluate(() => window.__qa.ctx.calls.state.local.getVideoTracks()[0].enabled), false)
  if (!realRtc) {
    assert.deepEqual(await a.evaluate(() => window.testPeer.config.iceServers), [
      { urls: 'stun:stun.example.test:3478' },
      { urls: 'turns:turn.example.test:5349?transport=tcp', username: 'fixture-user', credential: 'fixture-secret' },
    ])
    const oldCamera = await a.evaluateHandle(() => window.__qa.ctx.calls.state.local.getVideoTracks()[0])
    await panel(a).getByRole('button', { name: '通话设备' }).click()
    await panel(a).getByLabel('视频来源').selectOption('cam-b')
    await a.waitForFunction(() => window.__qa.ctx.calls.state.cameraId === 'cam-b')
    assert.equal(await oldCamera.evaluate(track => track.readyState), 'ended')
    assert.equal(await a.evaluate(() => window.testPeer.getSenders().find(s => s.track.kind === 'video').track.enabled), false)
    await panel(a).getByLabel('麦克风').selectOption('mic-b')
    await a.waitForFunction(() => window.__qa.ctx.calls.state.microphoneId === 'mic-b')
    await panel(a).getByLabel('扬声器').selectOption('speaker-b')
    await a.waitForFunction(() => document.querySelector('video[aria-label="对方画面"]').sinkId === 'speaker-b')
    await a.evaluate(() => { window.denyScreen = true })
    await panel(a).getByRole('button', { name: '共享屏幕' }).click()
    await a.waitForFunction(() => window.__qa.ctx.ui.state.toasts.some(toast => toast.text === '未授权桌面采集，或已取消选择。'))
    assert.equal(await a.evaluate(() => window.__qa.ctx.calls.state.cameraId), 'cam-b')
    await a.evaluate(() => { window.denyScreen = false })
    await panel(a).getByRole('button', { name: '共享屏幕' }).click()
    await panel(a).getByRole('button', { name: '停止共享' }).waitFor()
    assert.equal(await a.evaluate(() => window.testPeer.getSenders().some(s => s.track === window.screenTrack)), true)
    await a.evaluate(() => { window.screenTrack.stop(); window.screenTrack.dispatchEvent(new Event('ended')) })
    await a.waitForFunction(() => !window.__qa.ctx.calls.state.sharing && !window.__qa.ctx.calls.state.videoPending)
    assert.equal(await a.evaluate(() => window.testPeer.getSenders().find(s => s.track.kind === 'video').track.getSettings().deviceId), 'cam-b')
    assert.equal(await a.evaluate(() => window.testPeer.getSenders().find(s => s.track.kind === 'video').track.enabled), false)
    await panel(a).getByRole('button', { name: '共享屏幕' }).click()
    await panel(a).getByRole('button', { name: '停止共享' }).waitFor()
  }
  await panel(b).getByRole('button', { name: '软件内全屏' }).click()
  await panel(b).getByRole('button', { name: '退出软件内全屏' }).click()
  await panel(b).getByRole('button', { name: '最小化通话' }).click()
  await panel(b).getByRole('button', { name: '展开通话' }).click()
  await panel(b).getByRole('button', { name: '挂断' }).click()
  await panel(a).waitFor({ state: 'hidden' })
  if (!realRtc) assert.equal(await a.evaluate(() => window.screenTrack.readyState), 'ended')
  assert.equal(sent.find(item => item.type === 12).title, '视频通话')
  console.log(`PASS: narrow composer, video preview, ${realRtc ? 'real transport' : 'device replacement, screen sharing and ICE configuration'}, and hang-up`)

  await callButton(a, '发起语音通话').click()
  await panel(b).getByRole('button', { name: '拒绝' }).click()
  await panel(a).waitFor({ state: 'hidden' })
  assert.ok(sent.some(item => item.path === '/v1/live/refuse'))
  await callButton(a, '发起语音通话').click()
  await panel(b).getByRole('button', { name: '接听' }).waitFor()
  await panel(a).getByRole('button', { name: '取消' }).click()
  await panel(b).waitFor({ state: 'hidden' })
  assert.ok(sent.some(item => item.path === '/v1/live/cancel'))
  assert.deepEqual(errors, [])
  console.log('PASS: opt-in, bot exclusion and protocol-shaped private refuse/cancel')
  if (!realRtc) {
    const groupPanel = page => page.getByRole('region', { name: '群通话' })
    await open(a, 'group-test', 2)
    await callButton(a, '发起视频通话').click()
    await groupPanel(a).getByRole('checkbox', { name: /Bravo 群成员/ }).check()
    await groupPanel(a).getByRole('button', { name: '预览视频（1）' }).click()
    await groupPanel(a).getByRole('button', { name: '通话设备' }).click()
    await groupPanel(a).getByLabel('视频来源').selectOption('screen')
    await groupPanel(a).getByRole('button', { name: '停止共享' }).waitFor()
    await groupPanel(a).getByRole('button', { name: '发起视频通话' }).click()
    await groupPanel(b).getByRole('status').filter({ hasText: '群视频通话 · 邀请你通话' }).waitFor()
    await groupPanel(b).getByRole('button', { name: '接听' }).click()
    for (const page of [a, b]) await groupPanel(page).getByRole('status').filter({ hasText: '群视频通话 · 通话中' }).waitFor()
    assert.equal(await a.evaluate(() => window.groupTransport.tracks.video === window.screenTrack), true)
    assert.equal(await a.evaluate(() => window.groupTransport.token), 'offline-group-host')
    assert.equal(await b.evaluate(() => window.groupTransport.token), 'offline-group-guest')
    await groupPanel(a).getByLabel('视频来源').selectOption('cam-b')
    await a.waitForFunction(() => window.groupTransport.tracks.video?.getSettings().deviceId === 'cam-b')
    assert.equal(await a.evaluate(() => window.screenTrack.readyState), 'ended')
    await a.evaluate(() => { window.blockGroupReplacement = true })
    await groupPanel(a).getByLabel('视频来源').selectOption('screen')
    await a.waitForFunction(() => !!window.pendingGroupTrack)
    await groupPanel(a).getByRole('button', { name: '挂断' }).click()
    await groupPanel(b).getByRole('button', { name: '挂断' }).click()
    await a.waitForFunction(() => window.groupTransport.closed)
    await b.waitForFunction(() => window.groupTransport.closed)
    assert.deepEqual(await a.evaluate(() => ({
      detached: window.groupTransport.detached, pendingTrack: window.pendingGroupTrack.readyState,
    })), { detached: true, pendingTrack: 'ended' })
    await a.evaluate(() => window.resumeGroupReplacement())
    assert.deepEqual(groupRequests.slice(0, 2), ['start', '/v1/live/join'])
    assert.equal(groupRequests.filter(path => path === '/v1/live/hang_up').length, 2)
    await b.evaluate(() => window.__qa.ctx.callFixture.groupInvite('official-group-invite', 'alpha', 'group-test'))
    await groupPanel(b).getByRole('status').filter({ hasText: '群通话 · 邀请你通话' }).waitFor()
    await groupPanel(b).getByRole('button', { name: '接听' }).click()
    await groupPanel(b).getByRole('status').filter({ hasText: '群通话 · 通话中' }).waitFor()
    assert.equal(await b.evaluate(() => window.groupTransport.token), 'offline-direct-join')
    await groupPanel(b).getByRole('button', { name: '挂断' }).click()
    await groupPanel(b).waitFor({ state: 'hidden' })
    groupInvitation = null
    assert.deepEqual(errors, [])
    console.log('PASS: group toolbar, selected-member video invite, protobuf token, JSON join, native invite frame and screen video source')

    await open(b, 'public-room-group', 2)
    const roomBanner = b.getByRole('region', { name: '正在进行的群语音房' })
    await roomBanner.getByText('进行中的语音房', { exact: true }).waitFor()
    await roomBanner.getByRole('button', { name: '加入语音房' }).click()
    await groupPanel(b).getByRole('status').filter({ hasText: '群聊语音房 · 通话中' }).waitFor()
    assert.equal(await b.evaluate(() => window.groupTransport.token), 'offline-open-room')
    assert.equal(await b.evaluate(() => window.__qa.ctx.calls.state.local.getTracks().length), 0)
    const roster = groupPanel(b).getByRole('region', { name: '房间成员' })
    await b.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      window.testRoomVideo = stream
      window.groupTransport.updatePeers([
        { id: 'listener', name: '仅收听的成员', stream: new MediaStream(), hasVideo: false, microphone: false },
        { id: 'presenter', name: '共享的成员', stream, hasVideo: true, sharing: true, speaking: true, microphone: true, quality: 'good' },
      ])
    })
    await roster.getByText('3 人').waitFor()
    await roster.getByRole('article', { name: '仅收听的成员' }).waitFor()
    await roster.getByRole('button', { name: '放大共享的成员的画面' }).click()
    await groupPanel(b).getByRole('button', { name: '退出软件内全屏' }).waitFor()
    await groupPanel(b).getByRole('button', { name: '全屏观看' }).click()
    await b.waitForFunction(() => !!document.fullscreenElement)
    await b.evaluate(() => document.exitFullscreen())
    await groupPanel(b).getByRole('button', { name: '屏幕画质' }).click()
    const profile = groupPanel(b).getByRole('group', { name: '屏幕共享画质' })
    await profile.getByLabel('分辨率').selectOption('4320')
    await profile.getByLabel('帧率').selectOption('240')
    await profile.getByLabel('码率上限').selectOption('50')
    await groupPanel(b).getByRole('button', { name: '共享屏幕' }).click()
    await profile.getByText('7680 × 4320 · 60 FPS', { exact: false }).waitFor()
    assert.deepEqual(await b.evaluate(() => window.groupTransport.profile), { height: 4320, fps: 240, mbps: 50 })
    await profile.getByLabel('分辨率').selectOption('0')
    await profile.getByLabel('帧率').selectOption('0')
    assert.deepEqual(await b.evaluate(() => window.screenCaptureLimits), { frameRate: { ideal: 240 } })
    await profile.getByLabel('分辨率').selectOption('1440')
    await profile.getByLabel('帧率').selectOption('30')
    await profile.getByText('2560 × 1440 · 30 FPS', { exact: false }).waitFor()
    assert.deepEqual(await b.evaluate(() => window.screenCaptureLimits), { height: { ideal: 1440, max: 1440 }, frameRate: { ideal: 30, max: 30 } })
    if (process.env.YH_ROOM_SCREENSHOT) await b.screenshot({ path: process.env.YH_ROOM_SCREENSHOT })
    const popupPromise = b.waitForEvent('popup')
    await groupPanel(b).getByRole('button', { name: '移到独立窗口' }).click()
    const popup = await popupPromise
    await groupPanel(popup).getByRole('button', { name: '停止共享' }).waitFor()
    assert.equal(await groupPanel(b).count(), 0)
    assert.equal(await b.evaluate(() => window.groupTransport.connected && !window.groupTransport.closed), true)
    await Promise.all([
      popup.waitForEvent('close'),
      groupPanel(popup).getByRole('button', { name: '返回主窗口' }).click().catch(error => {
        if (!popup.isClosed()) throw error
      }),
    ])
    await groupPanel(b).getByRole('button', { name: '停止共享' }).waitFor()
    assert.equal(await b.evaluate(() => window.screenTrack.readyState), 'live')
    await groupPanel(b).getByRole('button', { name: '停止共享' }).click()
    await b.evaluate(() => { window.testRoomVideo.getTracks().forEach(track => track.stop()) })
    console.log('PASS: listening roster, late screen share, focus/fullscreen, applied screen settings and same-call popup round trip')
    await groupPanel(b).getByRole('button', { name: '打开麦克风' }).click()
    await b.waitForFunction(() => !!window.groupTransport.tracks.audio)
    await groupPanel(b).getByRole('button', { name: '挂断' }).click()
    await groupPanel(b).waitFor({ state: 'hidden' })
    await open(b, 'bravo-private')
    assert.equal(await roomBanner.count(), 0)
    console.log('PASS: public voice room list, explicit join without microphone permission and leave')

    await open(a, 'bravo')
    await a.evaluate(() => { window.denyDevices = true })
    await b.evaluate(() => { window.denyDevices = true })
    await callButton(a, '发起视频通话').click()
    await panel(a).getByRole('status').filter({ hasText: '确认画面后发起呼叫' }).waitFor()
    assert.equal(await a.evaluate(() => window.__qa.ctx.calls.state.local.getTracks().length), 0)
    await panel(a).getByRole('button', { name: '音视频设置' }).click()
    await a.getByRole('heading', { name: '音频与视频' }).waitFor()
    await a.getByLabel('输入设备').selectOption('mic-b')
    await a.getByLabel('视频输入源').selectOption('cam-b')
    assert.deepEqual(await a.evaluate(() => {
      const { microphoneId, cameraId } = window.__qa.ctx.calls.state
      return { microphoneId, cameraId }
    }), { microphoneId: 'mic-b', cameraId: 'cam-b' })
    await panel(a).getByRole('button', { name: '展开通话' }).click()
    await panel(a).getByRole('button', { name: '共享屏幕' }).click()
    await panel(a).getByRole('button', { name: '停止共享' }).waitFor()
    await panel(a).getByRole('button', { name: '发起视频通话' }).click()
    await panel(b).getByRole('button', { name: '接听' }).click()
    await panel(b).getByRole('status').filter({ hasText: '视频通话 · 通话中' }).waitFor()
    await panel(b).getByRole('button', { name: '共享屏幕' }).click()
    await panel(b).getByRole('button', { name: '停止共享' }).waitFor()
    assert.ok(await b.evaluate(() => window.testPeer.getSenders().some(sender => sender.track === window.screenTrack)))
    await panel(b).getByRole('button', { name: '挂断' }).click()
    await panel(a).waitFor({ state: 'hidden' })
    await open(a, 'bravo')
    await callButton(a, '发起语音通话').click()
    await panel(b).getByRole('button', { name: '接听' }).click()
    await panel(b).getByRole('status').filter({ hasText: '语音通话 · 通话中' }).waitFor()
    await panel(b).getByRole('button', { name: '挂断' }).click()
    await panel(a).waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    console.log('PASS: voice and video without device permission, screen-source sending, and direct settings navigation')
  }
} finally {
  await browser?.close()
  await server.close()
}
