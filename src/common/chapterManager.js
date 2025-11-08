import file from '@system.file';

async function loadChapterList(bookName) {
    const listUri = `internal://files/books/${bookName}/list.txt`;
    
    try {
        let data = await new Promise((resolve, reject) => {
            file.readText({
                uri: listUri,
                success: resolve,
                fail: reject
            });
        });
        
        const chapters = parseChapterList(data.text);
        data = null;
        
        return chapters;
    } catch (error) {
        throw error;
    }
}

function parseChapterList(text) {
    if (!text) return [];
    
    let lines = text.split('\n');
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
    lines = null;
    
    const chapters = Array.from(chapterMap.values());
    chapters.sort((a, b) => a.index - b.index);
    
    return chapters;
}

async function getChapterPage(bookName, page = 0, pageSize = 8) {
    let allChapters = await loadChapterList(bookName);
    const totalPages = Math.ceil(allChapters.length / pageSize) || 1;
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    
    const start = safePage * pageSize;
    const end = start + pageSize;
    const chapters = allChapters.slice(start, end);
    
    const result = {
        chapters,
        totalPages,
        currentPage: safePage,
        totalChapters: allChapters.length
    };
    allChapters = null;
    return result;
}

async function findChapterPage(bookName, chapterIndex, pageSize = 8) {
    let allChapters = await loadChapterList(bookName);
    if (!allChapters || allChapters.length === 0) {
        return {
            chapters: [],
            totalPages: 1,
            currentPage: 0,
            totalChapters: 0
        };
    }

    const currentIndex = allChapters.findIndex(ch => ch.index === chapterIndex);
    const totalChapters = allChapters.length;
    const totalPages = Math.ceil(totalChapters / pageSize) || 1;
    let currentPage = 0;

    if (currentIndex >= 0) {
        currentPage = Math.floor(currentIndex / pageSize);
    }
    
    const start = currentPage * pageSize;
    const end = start + pageSize;
    const chapters = allChapters.slice(start, end);

    const result = {
        chapters,
        totalPages,
        currentPage,
        totalChapters
    };
    allChapters = null;
    return result;
}

async function getChapterByIndex(bookName, chapterIndex) {
    const chapters = await loadChapterList(bookName);
    return chapters.find(ch => ch.index === chapterIndex) || null;
}

async function getChapterInfo(bookName, chapterIndex) {
    let chapters = await loadChapterList(bookName);
    if (!chapters || chapters.length === 0) {
        return { chapter: null, chapterArrayIndex: -1, totalChapters: 0 };
    }
    
    let chapterArrayIndex = chapters.findIndex(c => c.index === chapterIndex);
    
    if (chapterArrayIndex === -1 && chapters.length > 0) {
        const result = { chapter: chapters[0], chapterArrayIndex: 0, totalChapters: chapters.length };
        chapters = null;
        return result;
    }
    
    const result = {
        chapter: chapters[chapterArrayIndex],
        chapterArrayIndex: chapterArrayIndex,
        totalChapters: chapters.length
    };
    chapters = null;
    return result;
}

async function getChapterByArrayIndex(bookName, arrayIndex) {
    const chapters = await loadChapterList(bookName);
    if (!chapters || arrayIndex < 0 || arrayIndex >= chapters.length) {
        return null;
    }
    return chapters[arrayIndex];
}

export default {
    loadChapterList,
    parseChapterList,
    getChapterPage,
    getChapterByIndex,
    getChapterInfo,
    getChapterByArrayIndex,
    findChapterPage
};
