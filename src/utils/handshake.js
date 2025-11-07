import interconn from './interconn.js';
import { versionCode } from "../manifest.json";
import router from '@system.router';

const MIN_PHONE_VERSION = 40410;
//握握手，握握双手
const type = "__hs__"
const TIMEOUT = 15000;

export default class InterHandshake extends interconn {
    /** @type {Promise<void>} */
    promise = null;
    /** @type {(value: void | PromiseLike<void>) => void} */
    resolve = null;
    timeout = null;
    constructor() {
        super();
        this.conn.onmessage = ({ data }) => {
            clearTimeout(this.timeout);
            this.timeout = setTimeout(() => this.promise = this.resolve = null, TIMEOUT);
            const { tag, ...payload } = JSON.parse(data);
            this.callbacks[tag](payload);
        }
        this.addListener(type, ({ count, version }) => {
            if ((version && version < MIN_PHONE_VERSION) || !version) {
                return router.replace({
                    uri: 'pages/confirm',
                    params: {
                        action: 'versionError',
                        title: '版本不兼容',
                        confirmText: '客户端版本过低',
                        subText: '请将手机客户端更新到最新版本再使用本小程序',
                    }
                });
            }
            if (count > 0) {
                if (this.promise) this.resolve(this.resolve = null)
                else {
                    this.promise = Promise.resolve()
                    this.callback()
                }
            }
            if (count++ < 2) super.send(type, { count, version: versionCode });
        })
        this.addEventListener((e) => {
            if (e !== "open") {
                this.resolve = null;
                this.promise = Promise.reject(new Error("connection closed"));
                clearTimeout(this.timeout);
                return
            }
            this.promise = this._newPromise()
        })
    }
    async send(...args) {
        if (this.promise) await this.promise;
        else await (this.promise = this._newPromise())
        return await super.send(...args)
    }
    setHandshakeListener(callback) {
        this.callback= callback
    }
    callback = () => { }
    get connected() { return this.promise !== null }
    _newPromise() {
        return new Promise(( resolve, reject ) => {
            const timeout = setTimeout(() => {
                reject(new Error("timeout"));
                this.promise = this.resolve = null;
            }, TIMEOUT)
            this.resolve = () => {
                resolve()
                clearTimeout(timeout)
            }
            super.send(type, { count: 0, version: versionCode })
        })
    }
}
