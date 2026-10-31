import { registerPluginPresentation } from '../plugin-presentations'
import { CaptchaSettings } from './captcha'

registerPluginPresentation({ id: 'captcha', name: { zh: '人机验证', en: 'Human verification' }, description: { zh: '保护登录和注册', en: 'Protect sign-in and registration' }, Settings: CaptchaSettings })
