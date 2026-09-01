import { describe, expect, it } from 'vitest'
import { renderSystemMailTemplate } from './mail-templates'
import {
  originalBusinessContent,
  systemErrorMessage,
  systemMessage,
  systemStatus,
} from './system'

describe('system internationalization', () => {
  it('translates navigation, statuses and stable errors in both supported locales', () => {
    expect(systemMessage('zh-CN', 'nav.games')).toBe('比赛')
    expect(systemMessage('en', 'nav.games')).toBe('Contests')
    expect(systemStatus('zh-CN', 'running')).toBe('进行中')
    expect(systemStatus('en', 'running')).toBe('Running')
    expect(systemErrorMessage('en', 'identity.registration_disabled')).toBe('Public registration is currently closed')
    expect(systemErrorMessage('zh-CN', 'unknown.code')).toBe('请求失败，请稍后重试')
  })

  it('renders security mail templates in Chinese and English', () => {
    const link = 'https://ctf.example.test/verify-email?token=opaque'
    expect(renderSystemMailTemplate('identity.email_verification_requested', {
      brandName: 'SauryCTF', locale: 'zh-CN', link,
    })).toEqual({ subject: '验证 SauryCTF 邮箱', text: `请打开以下链接验证邮箱：\n${link}` })
    expect(renderSystemMailTemplate('identity.email_verification_requested', {
      brandName: 'SauryCTF', locale: 'en', link,
    })).toEqual({ subject: 'Verify your SauryCTF email', text: `Open this link to verify your email:\n${link}` })
  })

  it('never translates organizer-authored business content', () => {
    const content = {
      contest: '春季赛 Spring Invitational',
      challenge: '不要翻译 this statement',
      announcement: '原定 12:00 开赛',
      writeup: '# 原始 Writeup',
    }
    expect(originalBusinessContent(content)).toBe(content)
    expect(originalBusinessContent(content.challenge)).toBe('不要翻译 this statement')
  })
})
