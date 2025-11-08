import file from '@system.file';

const chapterCache = new Map();
const CACHE_EXPIRY = 5 * 60 * 1000;

async function loadChapterList(bookName) {
    const cached = chapterCache.get(bookName);
    if (cached && (Date.now() - cached.timestamp < CACHE_EXPIRY)) {
        return [...cached.chapters];
    }
    
    const listUri = `internal://files/books/${bookName}/list.txt`;
    
    try {
        const data = await new Promise((resolve, reject) => {
            file.readText({
                uri: listUri,
                success: resolve,
                fail: reject
            });
        });
        
        const chapters = parseChapterList(data.text);
        
        chapterCache.set(bookName, {
            chapters,
            timestamp: Date.now()
        });
        
        return chapters;
    } catch (error) {
        throw error;
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
        chapterCache.delete(bookName);
    } else {
        chapterCache.clear();
    }
}

function preloadChapterList(bookName) {
    setTimeout(() => {
        loadChapterList(bookName).catch(e => {
        });
    }, 0);
}

async function getChapterPage(bookName, page = 0, pageSize = 8) {
    const allChapters = await loadChapterList(bookName);
    const totalPages = Math.ceil(allChapters.length / pageSize) || 1;
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    
    const start = safePage * pageSize;
    const end = start + pageSize;
    const chapters = allChapters.slice(start, end);
    
    return {
        chapters,
        totalPages,
        currentPage: safePage,
        totalChapters: allChapters.length
    };
}

async function getChapterByIndex(bookName, chapterIndex) {
    const chapters = await loadChapterList(bookName);
    return chapters.find(ch => ch.index === chapterIndex) || null;
}

export default {
    loadChapterList,
    parseChapterList,
    clearCache,
    preloadChapterList,
    getChapterPage,
    getChapterByIndex
};
