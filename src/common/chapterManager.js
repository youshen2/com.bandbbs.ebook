import file from '@system.file';
import router from '@system.router';

const bookIndexCache = new Map();
const chapterChunkCache = new Map();
const CACHE_EXPIRY = 5 * 60 * 1000;
const CHAPTERS_PER_FILE = 100;

async function checkVersion(bookName) {
    const oldListUri = `internal://files/books/${bookName}/list.txt`;
    const newListUri = `internal://files/books/${bookName}/lindex.txt`;
    try {
        await runAsyncFunc(file.access, { uri: newListUri });
        return 'new';
    } catch (e) {
        try {
            await runAsyncFunc(file.access, { uri: oldListUri });
            return 'old';
        } catch (err) {
            return 'none';
        }
    }
}

async function handleOldVersion(bookName) {
    router.push({
        uri: '/pages/confirm',
        params: {
            action: 'deleteBook',
            title: "不兼容的旧格式",
            subText: "需要删除数据",
            confirmText: `此书籍使用了旧的索引格式，必须删除后重新同步才能阅读。`,
            cPath: 'internal://files/books/' + bookName
        }
    });
}

function runAsyncFunc(fn, options) {
    return new Promise((resolve, reject) => {
        fn({
            ...options,
            success: resolve,
            fail: reject,
        });
    });
}

async function loadBookIndex(bookName) {
    const cached = bookIndexCache.get(bookName);
    if (cached && (Date.now() - cached.timestamp < CACHE_EXPIRY)) {
        return cached.index;
    }

    const indexUri = `internal://files/books/${bookName}/lindex.txt`;
    try {
        const data = await runAsyncFunc(file.readText, { uri: indexUri });
        const lines = data.text.split('\n');
        const totalChapters = parseInt(lines[0], 10) || 0;
        const syncedChapters = parseInt(lines[1], 10) || 0;
        const ranges = lines.slice(2).filter(Boolean).map(line => {
            const [start, end] = line.split(',').map(Number);
            return { start, end };
        });

        const bookIndex = { totalChapters, syncedChapters, ranges };
        bookIndexCache.set(bookName, {
            index: bookIndex,
            timestamp: Date.now()
        });
        return bookIndex;
    } catch (error) {
        throw new Error(`Failed to load book index for ${bookName}: ${error.message}`);
    }
}

async function loadChapterChunk(bookName, chunkIndex) {
    const cacheKey = `${bookName}_${chunkIndex}`;
    const cached = chapterChunkCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_EXPIRY)) {
        return cached.chapters;
    }

    const chunkUri = `internal://files/books/${bookName}/indexes/${chunkIndex}.txt`;
    try {
        const data = await runAsyncFunc(file.readText, { uri: chunkUri });
        const chapters = parseChapterList(data.text);
        chapterChunkCache.set(cacheKey, {
            chapters,
            timestamp: Date.now()
        });
        return chapters;
    } catch (error) {
        // console.error(`Failed to load chapter chunk ${chunkIndex} for ${bookName}:`, error);
        return [];
    }
}


function parseChapterList(text) {
    if (!text) return [];
    
    const lines = text.split('\n');
    const chapterMap = new Map();
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        try {
            const chapter = JSON.parse(line);
            if (chapter && typeof chapter.index === 'number' && chapter.name) {
                chapterMap.set(chapter.index, chapter);
            }
        } catch (e) {
            continue;
        }
    }
    
    const chapters = Array.from(chapterMap.values());
    chapters.sort((a, b) => a.index - b.index);
    
    return chapters;
}


function clearCache(bookName) {
    if (bookName) {
        bookIndexCache.delete(bookName);
        for (const key of chapterChunkCache.keys()) {
            if (key.startsWith(bookName + '_')) {
                chapterChunkCache.delete(key);
            }
        }
    } else {
        bookIndexCache.clear();
        chapterChunkCache.clear();
    }
}

async function getChapterPage(bookName, page = 0, pageSize = 8) {
    const version = await checkVersion(bookName);
    if (version === 'old') {
        await handleOldVersion(bookName);
        return { chapters: [], totalPages: 0, currentPage: 0, totalChapters: 0 };
    }
    if (version === 'none') {
        return { chapters: [], totalPages: 0, currentPage: 0, totalChapters: 0 };
    }

    const bookIndex = await loadBookIndex(bookName);
    if (!bookIndex || bookIndex.totalChapters === 0) {
        return { chapters: [], totalPages: 0, currentPage: 0, totalChapters: bookIndex ? bookIndex.totalChapters : 0 };
    }

    const { totalChapters } = bookIndex;
    const totalPages = Math.ceil(totalChapters / pageSize) || 1;
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const startChapterIndex = safePage * pageSize;
    const endChapterIndex = Math.min(startChapterIndex + pageSize, totalChapters);

    if (startChapterIndex >= endChapterIndex) {
        return { chapters: [], totalPages, currentPage: safePage, totalChapters };
    }
    
    const startChunk = Math.floor(startChapterIndex / CHAPTERS_PER_FILE) + 1;
    const endChunk = Math.floor((endChapterIndex - 1) / CHAPTERS_PER_FILE) + 1;

    let requiredChapters = [];
    if (startChunk === endChunk) {
        const chunk = await loadChapterChunk(bookName, startChunk);
        requiredChapters = chunk.filter(ch => ch.index >= startChapterIndex && ch.index < endChapterIndex);
    } else {
        const chunkPromises = [];
        for (let i = startChunk; i <= endChunk; i++) {
            chunkPromises.push(loadChapterChunk(bookName, i));
        }
        const chapterChunks = await Promise.all(chunkPromises);
        const allRelevantChapters = chapterChunks.flat();
        requiredChapters = allRelevantChapters.filter(ch => ch.index >= startChapterIndex && ch.index < endChapterIndex);
    }
    
    return {
        chapters: requiredChapters,
        totalPages,
        currentPage: safePage,
        totalChapters,
    };
}


async function getChapterByIndex(bookName, chapterIndex) {
    const bookIndex = await loadBookIndex(bookName);
    if (!bookIndex) return null;

    const chunkIndex = Math.floor(chapterIndex / CHAPTERS_PER_FILE) + 1;
    
    const chunk = await loadChapterChunk(bookName, chunkIndex);
    return chunk.find(ch => ch.index === chapterIndex) || null;
}

async function getTotalChapters(bookName) {
    const version = await checkVersion(bookName);
    if (version === 'old') {
        return 0;
    }
    if (version === 'none') {
        return 0;
    }
    try {
        const bookIndex = await loadBookIndex(bookName);
        return bookIndex.totalChapters;
    } catch (e) {
        return 0;
    }
}

async function getSyncedChapters(bookName) {
    const version = await checkVersion(bookName);
    if (version === 'old') {
        return 0;
    }
    if (version === 'none') {
        return 0;
    }
    try {
        const bookIndex = await loadBookIndex(bookName);
        return bookIndex.syncedChapters;
    } catch (e) {
        return 0;
    }
}

export default {
    checkVersion,
    handleOldVersion,
    clearCache,
    getChapterPage,
    getChapterByIndex,
    loadBookIndex,
    getTotalChapters,
    getSyncedChapters
};

