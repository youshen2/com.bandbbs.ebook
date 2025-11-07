import file from "@system.file";
import storage from '../common/storage.js';
import runAsyncFunc from "./runAsyncFunc";
import str2abWrite from "./str2abWrite";

export default class interconnfile {
    static "__interconnModule__" = true;
    static name = 'file';
    baseUri = 'internal://files/books/';
    currentBookName = "";
    currentBookDir = "";
    totalChapters = 0;
    receivedChapters = 0;
    currentSavingChapterIndex = -1;
    currentChapterMeta = null;
    isCoverOnly = false;
    syncedChapterIndices = new Set();
    
    pendingChapterMetas = [];
    BATCH_WRITE_SIZE = 10;

    constructor({ addListener, send, setEventListener }) {
        const onmessage = async (data) => {
            const { stat, ...payload } = data;
            switch (stat) {
                case "startTransfer":
                    this.isCoverOnly = false;
                    this.startTransfer(payload);
                    break;
                case "start_cover_transfer":
                    this.isCoverOnly = true;
                    this.startCoverTransfer(payload);
                    break;
                case "d":
                    this.saveChapter(payload);
                    break;
                case "chapter_complete":
                    this.completeChapterTransfer(payload);
                    break;
                case "transfer_complete":
                    this.handleTransferComplete();
                    break;
                case "cancel":
                    if (this.pendingChapterMetas && this.pendingChapterMetas.length > 0) {
                        await this.flushPendingChapterMetas().catch(e => {
                            // console.error('Failed to flush pending metas on cancel:', e);
                        });
                    }
                    this.send({ type: "cancel" });
                    this.currentBookName = "";
                    this.currentBookDir = "";
                    this.pendingChapterMetas = [];
                    this.callback({ msg: "cancel" });
                    break;
                case "get_book_status":
                    this.getBookStatus(payload);
                    break;
                case "cover_chunk":
                    this.saveCoverChunk(payload);
                    break;
                case "cover_transfer_complete":
                    this.completeCoverTransfer();
                    break;
            }
        }
        addListener(onmessage);
        this.send = send;
        setEventListener((event) => {
            if (event !== 'open') {
                if (this.pendingChapterMetas && this.pendingChapterMetas.length > 0) {
                    this.flushPendingChapterMetas().catch(e => {
                        // console.error('Failed to flush pending metas on disconnect:', e);
                    });
                }
                this.currentBookName = "";
                this.currentBookDir = "";
                this.callback({ msg: "error", error: event, filename: this.currentBookName });
            }
        })
    }

    async getUsage() {
        try {
            const { fileList } = await runAsyncFunc(file.list, { uri: this.baseUri });
            let usage = 0;
            for (const item of fileList) {
                if (item.type === 'dir') {
                    try {
                        const dirStat = await runAsyncFunc(file.stat, { uri: item.uri });
                        usage += dirStat.size;
                    } catch (e) {
                    }
                } else {
                    usage += item.length;
                }
            }
            return usage;
        } catch (error) {
            return 0;
        }
    }

    generateDirName(filename) {
        let hash = 0;
        for (let i = 0; i < filename.length; i++) {
            const char = filename.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        const hashStr = Math.abs(hash).toString(36);
        
        const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const truncated = sanitized.substring(0, 30);
        return `${truncated}_${hashStr}`;
    }

    async getBookStatus({ filename }) {
        
        try {
            await runAsyncFunc(file.access, { uri: this.baseUri });
        } catch (e) {
            this.send({ type: "book_status", syncedChapters: [], hasCover: false });
            return;
        }
        
        const sanitizedDirName = this.generateDirName(filename);
        const listUri = `${this.baseUri}${sanitizedDirName}/list.txt`;
        const coverUri = `${this.baseUri}${sanitizedDirName}/cover.jpg`;
        let syncedChapterIndices = [];
        let hasCover = false;
        
        try {
            const data = await runAsyncFunc(file.readText, { uri: listUri });
            const lines = data.text.split('\n').filter(Boolean);
            
            const indexSet = new Set();
            for (const line of lines) {
                try {
                    const chapterMeta = JSON.parse(line);
                    if (chapterMeta.index !== null && chapterMeta.index !== undefined) {
                        indexSet.add(chapterMeta.index);
                    }
                } catch (e) {
                    
                }
            }
            syncedChapterIndices = Array.from(indexSet);
        } catch (e) {
            syncedChapterIndices = [];
        }
        
        try {
            await runAsyncFunc(file.access, { uri: coverUri });
            hasCover = true;
        } catch (e) {
            hasCover = false;
        }
        
        this.send({ type: "book_status", syncedChapters: syncedChapterIndices, hasCover: hasCover });
        
        syncedChapterIndices = null;
    }
    
    async startCoverTransfer({ filename }) {
        try {
            if (!filename || !filename.trim()) {
                this.send({ type: "error", message: "Filename is empty.", count: 0 });
                return;
            }
            this.currentBookName = filename;
            this.currentBookDir = this.generateDirName(filename);

            
            try {
                await runAsyncFunc(file.access, { uri: this.baseUri });
            } catch (e) {
                await runAsyncFunc(file.mkdir, { uri: this.baseUri, recursive: true });
            }

            const bookUri = this.baseUri + this.currentBookDir;
            
            try {
                await runAsyncFunc(file.access, { uri: bookUri });
            } catch (e) {
                await runAsyncFunc(file.mkdir, { uri: bookUri });
            }
            
            
            const coverUri = bookUri + '/cover.jpg';
            try {
                await runAsyncFunc(file.access, { uri: coverUri });
                await runAsyncFunc(file.delete, { uri: coverUri });
            } catch (e) {
                
            }
            
            this.currentBookCoverUri = coverUri;
            
            // console.log(`Cover-only transfer initialized: ${coverUri}`);
            this.send({ type: "cover_ready" });
        } catch (error) {
            this.send({ type: "error", message: `Start cover transfer failed: ${error.message || 'unknown error'}`, count: 0 });
        }
    }

    async startTransfer({ filename, total, wordCount, startFrom = 0, hasCover = false, author = null, summary = null, bookStatus = null, category = null }) {
        try {
            if (!filename || !filename.trim()) {
                this.send({ type: "error", message: "文件名为空或无效", count: 0 });
                this.callback({ msg: "error", error: "文件名为空或无效" });
                return;
            }

            const sanitizedDirName = this.generateDirName(filename);
            this.currentBookName = filename;
            this.currentBookDir = sanitizedDirName;
            this.totalChapters = total;
            this.receivedChapters = startFrom;
            this.pendingChapterMetas = [];

            this.callback({ msg: "start", total, filename: filename });

            
            try {
                await runAsyncFunc(file.access, { uri: this.baseUri });
            } catch (e) {
                await runAsyncFunc(file.mkdir, { uri: this.baseUri, recursive: true });
            }

            const bookUri = this.baseUri + this.currentBookDir;
            const bookInfoUri = bookUri + '/book_info.json';
            const listUri = bookUri + '/list.txt';
            const coverUri = bookUri + '/cover.jpg';
            const contentUri = bookUri + '/content';
            const bookshelfUri = this.baseUri + 'bookshelf.json';

            try {
                const bookInfoData = await runAsyncFunc(file.readText, { uri: bookInfoUri });
                const bookInfo = JSON.parse(bookInfoData.text);
                if (bookInfo.hasCover && !hasCover) {
                    hasCover = true;
                }
            } catch (e) {

            }


            if (startFrom === 0) {
                let progress = null;
                try {
                    const progressUri = bookUri + '/progress.json';
                    const data = await runAsyncFunc(file.readText, { uri: progressUri });
                    progress = data.text;
                } catch(e) { /* no progress file, that's ok */ }

                let coverRestored = false;
                const tempCoverUri = this.baseUri + 'temp_cover.jpg';
                try {
                    await runAsyncFunc(file.move, { srcUri: coverUri, dstUri: tempCoverUri });
                    coverRestored = true;
                } catch(e) {}

                try { await runAsyncFunc(file.rmdir, { uri: bookUri, recursive: true }); } catch (e) {}
                await runAsyncFunc(file.mkdir, { uri: bookUri });
                
                if (progress) {
                    const progressUri = bookUri + '/progress.json';
                    await runAsyncFunc(file.writeText, { uri: progressUri, text: progress });
                }

                if (coverRestored) {
                    try {
                        await runAsyncFunc(file.move, { srcUri: tempCoverUri, dstUri: coverUri });
                    } catch(e) {}
                }

                await runAsyncFunc(file.writeText, { uri: listUri, text: '' });
                this.syncedChapterIndices = new Set();
            } else {
                
                try {
                    await runAsyncFunc(file.access, { uri: bookUri });
                } catch (e) {
                    
                    await runAsyncFunc(file.mkdir, { uri: bookUri });
                    await runAsyncFunc(file.writeText, { uri: listUri, text: '' });
                    this.receivedChapters = 0;
                }
                
                
                try {
                    const listData = await runAsyncFunc(file.readText, { uri: listUri });
                    const existingChaptersLines = listData.text.split('\n').filter(Boolean);
                    this.syncedChapterIndices = new Set();
                    const chapterMetas = new Map();
                    for (const line of existingChaptersLines) {
                        try {
                            const meta = JSON.parse(line);
                            chapterMetas.set(meta.index, meta);
                        } catch (e) {
                            // console.error('Failed to parse chapter meta from list.txt:', line);
                        }
                    }

                    if (existingChaptersLines.length !== chapterMetas.size) {
                        const cleanedMetaLines = Array.from(chapterMetas.values()).map(meta => JSON.stringify(meta));
                        await runAsyncFunc(file.writeText, { uri: listUri, text: cleanedMetaLines.join('\n') + '\n' });
                    }

                    for (const index of chapterMetas.keys()) {
                        this.syncedChapterIndices.add(index);
                    }
                    this.receivedChapters = this.syncedChapterIndices.size;
                } catch (e) {
                    
                    await runAsyncFunc(file.writeText, { uri: listUri, text: '' });
                    this.receivedChapters = 0;
                    this.syncedChapterIndices = new Set();
                }
            }

            
            try {
                await runAsyncFunc(file.access, { uri: contentUri });
            } catch (e) {
                await runAsyncFunc(file.mkdir, { uri: contentUri });
            }

            
            if (hasCover) {
                this.currentBookCoverUri = coverUri;
                // console.log(`Cover transfer initialized: ${coverUri}`);
            }

            const bookInfo = { 
                name: filename, 
                chapterCount: total, 
                wordCount: wordCount, 
                hasCover: hasCover,
                author: author,
                summary: summary,
                bookStatus: bookStatus,
                category: category
            };
            await runAsyncFunc(file.writeText, { uri: bookInfoUri, text: JSON.stringify(bookInfo) });
            
            let bookshelf = [];
            try {
                const data = await runAsyncFunc(file.readText, { uri: bookshelfUri });
                bookshelf = JSON.parse(data.text);
            } catch (e) {}

            const existingBookIndex = bookshelf.findIndex(b => b.dirName === this.currentBookDir);
            if (existingBookIndex > -1) {
                bookshelf[existingBookIndex].name = filename;
                bookshelf[existingBookIndex].chapterCount = total;
                bookshelf[existingBookIndex].wordCount = wordCount;
                bookshelf[existingBookIndex].hasCover = hasCover;
            } else {
                bookshelf.push({ name: filename, dirName: this.currentBookDir, chapterCount: total, wordCount: wordCount, progress: 0, hasCover: hasCover });
            }
            await runAsyncFunc(file.writeText, { uri: bookshelfUri, text: JSON.stringify(bookshelf) });

            this.send({ type: "ready", count: startFrom, usage: await this.getUsage() });
        } catch (error) {
            const errorMsg = error.message || '未知错误';
            let displayMsg = `开始传输失败: ${errorMsg}`;
            
            // 检测空间不足错误
            if (errorMsg.includes('space') || errorMsg.includes('disk') || errorMsg.includes('full') || 
                errorMsg.includes('storage') || errorMsg.includes('1300') || errorMsg.includes('202')) {
                displayMsg = "存储空间不足";
            }
            
            this.send({ type: "error", message: displayMsg, count: 0 });
            this.callback({ msg: "error", error: displayMsg });
        }
    }

    async saveCoverChunk({ chunkIndex, totalChunks, data }) {
        try {
            if (!this.currentBookCoverUri) {
                // console.error('Cover URI not initialized');
                this.send({ type: "error", message: "封面传输未初始化", count: 0 });
                return;
            }
            const coverBytes = this.base64ToArrayBuffer(data);
            if (coverBytes.byteLength > 0) {
                await runAsyncFunc(file.writeArrayBuffer, {
                    uri: this.currentBookCoverUri,
                    buffer: new Uint8Array(coverBytes),
                    append: chunkIndex > 0,
                });
            }
            await this.send({ type: "cover_chunk_received" });
        } catch (error) {
            const errorMsg = error.message || '未知错误';
            let displayMsg = `保存封面分块失败: ${errorMsg}`;
            if (errorMsg.includes('space') || errorMsg.includes('disk') || errorMsg.includes('full') || 
                errorMsg.includes('storage') || errorMsg.includes('1300') || errorMsg.includes('202')) {
                displayMsg = "存储空间不足";
            }
            this.send({ type: "error", message: displayMsg, count: 0 });
            this.callback({ msg: "error", error: displayMsg });
        }
    }

    async completeCoverTransfer() {
        try {
            if (!this.currentBookCoverUri) {
                this.send({ type: "error", message: "没有封面数据可保存", count: 0 });
                return;
            }
            
            // console.log(`Cover image saved successfully.`);
            
            await this.updateCoverStatus(true);
            
            this.currentBookCoverUri = null;
        
            this.send({ type: "cover_saved" });
            
            if (this.isCoverOnly) {
                this.callback({ msg: "success" });
                this.currentBookName = "";
                this.currentBookDir = "";
            }
        } catch (error) {
            // console.error('Failed to complete cover transfer:', error);
            this.currentBookCoverUri = null;
            const errorMsg = error.message || '未知错误';
            let displayMsg = `完成封面传输失败: ${errorMsg}`;
            if (errorMsg.includes('space') || errorMsg.includes('disk') || errorMsg.includes('full') || 
                errorMsg.includes('storage') || errorMsg.includes('1300') || errorMsg.includes('202')) {
                displayMsg = "存储空间不足";
            }
            this.send({ type: "error", message: displayMsg, count: 0 });
            this.callback({ msg: "error", error: displayMsg });
        }
    }

    async updateCoverStatus(hasCover) {
        const bookUri = this.baseUri + this.currentBookDir;
        const bookInfoUri = bookUri + '/book_info.json';
        const bookshelfUri = this.baseUri + 'bookshelf.json';
        
        try {
            let bookInfo = {};
            try {
                const bookInfoData = await runAsyncFunc(file.readText, { uri: bookInfoUri });
                bookInfo = JSON.parse(bookInfoData.text);
            } catch(e) { /* file might not exist */ }
            bookInfo.hasCover = hasCover;
            await runAsyncFunc(file.writeText, { uri: bookInfoUri, text: JSON.stringify(bookInfo) });
            
            let bookshelf = [];
            try {
                const bookshelfData = await runAsyncFunc(file.readText, { uri: bookshelfUri });
                bookshelf = JSON.parse(bookshelfData.text);
            } catch (e) { /* file might not exist */ }
            const bookIndex = bookshelf.findIndex(b => b.dirName === this.currentBookDir);
            if (bookIndex > -1) {
                bookshelf[bookIndex].hasCover = hasCover;
                await runAsyncFunc(file.writeText, { uri: bookshelfUri, text: JSON.stringify(bookshelf) });
            }
        } catch (e) {
            // console.error('Failed to update cover status:', e);
        }
    }

    base64ToArrayBuffer(base64) {
        
        base64 = base64.replace(/[\s\r\n]/g, '');
        
        const b64lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const len = base64.length;
        
        
        let paddingCount = 0;
        if (base64.charAt(len - 1) === '=') paddingCount++;
        if (base64.charAt(len - 2) === '=') paddingCount++;
        
        const bufferLength = (len * 3 / 4) - paddingCount;
        const arraybuffer = new ArrayBuffer(bufferLength);
        const bytes = new Uint8Array(arraybuffer);
        
        let p = 0;
        for (let i = 0; i < len; i += 4) {
            const encoded1 = b64lookup.indexOf(base64.charAt(i));
            const encoded2 = b64lookup.indexOf(base64.charAt(i + 1));
            const encoded3 = b64lookup.indexOf(base64.charAt(i + 2));
            const encoded4 = b64lookup.indexOf(base64.charAt(i + 3));
            
            
            if (encoded1 === -1 || encoded2 === -1) {
                // console.error('Invalid base64 character found');
                continue;
            }
            
            
            if (p < bufferLength) {
                bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
            }
            
            
            if (encoded3 !== -1 && encoded3 !== 64 && p < bufferLength) {
                bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            }
            
            
            if (encoded4 !== -1 && encoded4 !== 64 && p < bufferLength) {
                bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
            }
        }
        
        return arraybuffer;
    }

    _strToUtf8Ab(str) {
        var s = unescape(encodeURIComponent(str));
        var b = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) {
            b[i] = s.charCodeAt(i);
        }
        return b;
    }

    async saveChapter(payload) {
        try {
            const { count, data } = payload;
            let chapterData = JSON.parse(data);

            const isFirstChunk = chapterData.chunkNum === 0;
            const isLastChunk = chapterData.chunkNum === chapterData.totalChunks - 1;
            const chapterFileName = `${chapterData.index}.txt`;
            const chapterUri = `${this.baseUri}${this.currentBookDir}/content/${chapterFileName}`;

            const buffer = str2abWrite(chapterData.content);

            if (isFirstChunk) {
                this.currentSavingChapterIndex = chapterData.index;

                await runAsyncFunc(file.writeArrayBuffer, {
                    uri: chapterUri,
                    buffer: buffer,
                    append: false,
                });
            } else {
                if (this.currentSavingChapterIndex !== chapterData.index) {
                    this.send({ type: "error", message: "章节分块索引不匹配", count: this.receivedChapters });
                    chapterData = null;
                    return;
                }
                await runAsyncFunc(file.writeArrayBuffer, {
                    uri: chapterUri,
                    buffer: buffer,
                    append: true,
                });
            }
            
            const chunkProgress = (chapterData.chunkNum + 1) / chapterData.totalChunks;
            const overallProgress = (count + chunkProgress) / (this.totalChapters);
            this.callback({ msg: "next", progress: overallProgress, filename: this.currentBookName });

            if (isLastChunk) {
                this.currentChapterMeta = {
                    index: chapterData.index,
                    name: chapterData.name,
                    wordCount: chapterData.wordCount
                };

                await this.send({ type: "chapter_chunk_complete" });
                
                if(count % 50 == 0) global.runGC();
            } else {
                await this.send({ type: "next_chunk" });
            }
            chapterData = null;
        } catch (error) {
            const errorMsg = error.message || '未知错误';
            let displayMsg = `保存章节失败: ${errorMsg}`;
            if (errorMsg.includes('space') || errorMsg.includes('disk') || errorMsg.includes('full') || 
                errorMsg.includes('storage') || errorMsg.includes('1300') || errorMsg.includes('202')) {
                displayMsg = "存储空间不足";
            }
            this.send({ type: "error", message: displayMsg, count: this.receivedChapters });
            this.callback({ msg: "error", progress: displayMsg });
        }
    }

    async completeChapterTransfer(payload) {
        try {
            const { count } = payload;
            
            if (!this.currentChapterMeta) {
                this.send({ type: "error", message: "No chapter data to complete", count: this.receivedChapters });
                return;
            }
            
            this.pendingChapterMetas.push(this.currentChapterMeta);
            
            this.currentChapterMeta = null;
            this.currentSavingChapterIndex = -1;
            this.syncedChapterIndices.add(count);
            this.receivedChapters = this.syncedChapterIndices.size;
            
            const shouldFlush = (this.pendingChapterMetas.length >= this.BATCH_WRITE_SIZE) || 
                               (this.receivedChapters >= this.totalChapters);
            
            if (shouldFlush) {
                await this.flushPendingChapterMetas();
            }
            
            const progressPercent = (this.receivedChapters / this.totalChapters) * 100;
            
            await this.send({ 
                type: "chapter_saved", 
                count: this.receivedChapters,
                syncedCount: this.receivedChapters,
                totalCount: this.totalChapters,
                progress: progressPercent
            });
            
        } catch (error) {
            const errorMsg = error.message || '未知错误';
            let displayMsg = `完成章节传输失败: ${errorMsg}`;
            if (errorMsg.includes('space') || errorMsg.includes('disk') || errorMsg.includes('full') || 
                errorMsg.includes('storage') || errorMsg.includes('1300') || errorMsg.includes('202')) {
                displayMsg = "存储空间不足";
            }
            this.send({ type: "error", message: displayMsg, count: this.receivedChapters });
            this.callback({ msg: "error", error: displayMsg });
        }
    }
    
    async flushPendingChapterMetas() {
        if (this.pendingChapterMetas.length === 0) return;
        const listUri = `${this.baseUri}${this.currentBookDir}/list.txt`;
        try {
            const metaLines = this.pendingChapterMetas.map(meta => JSON.stringify(meta)).join('\n') + '\n';
            const buffer = this._strToUtf8Ab(metaLines);
            await runAsyncFunc(file.writeArrayBuffer, {
                uri: listUri,
                buffer: buffer,
                append: true,
            });
            this.pendingChapterMetas = [];
        } catch (error) {
            // console.error('Failed to flush chapter metas:', error);
            throw error;
        }
    }

    async handleTransferComplete() {
        try {
            if (this.pendingChapterMetas.length > 0) {
                await this.flushPendingChapterMetas();
            }
            
            this.currentBookCoverUri = null;
            this.currentSavingChapterIndex = -1;
            this.currentChapterMeta = null;
            this.pendingChapterMetas = [];
            this.currentBookName = "";
            this.currentBookDir = "";
            
            if (typeof global !== 'undefined' && typeof global.runGC === 'function') {
                global.runGC();
            }
            
            this.send({ type: "transfer_finished" });
            
            this.callback({ msg: "success" });
        } catch (error) {
            // console.error('Failed to handle transfer complete:', error);
            this.send({ type: "error", message: `Handle transfer complete failed: ${error.message || 'unknown error'}`, count: 0 });
        }
    }

    setCallback(callback) {
        this.callback = callback;
    }
    callback(msg) {  }
}
