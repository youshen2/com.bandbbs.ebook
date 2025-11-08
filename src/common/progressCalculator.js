import file from '@system.file';
import chapterManager from './chapterManager.js';

const META_FILE = 'progress_meta.json';

async function calculateAndSaveProgressMeta(bookName) {
    try {
        let chapters = await chapterManager.loadChapterList(bookName);
        if (!chapters || chapters.length === 0) {
            return;
        }

        let totalSize = 0;
        const chaptersMeta = [];

        for (const chapter of chapters) {
            const chapterUri = `internal://files/books/${bookName}/content/${chapter.index}.txt`;
            try {
                const chapterInfo = await new Promise((resolve, reject) => {
                    file.get({
                        uri: chapterUri,
                        success: resolve,
                        fail: reject
                    });
                });

                chaptersMeta.push({
                    index: chapter.index,
                    size: chapterInfo.length,
                    offset: totalSize
                });
                totalSize += chapterInfo.length;

            } catch (e) {
            }
        }
        chapters = null;

        const metaData = {
            totalSize,
            chapters: chaptersMeta,
            lastUpdated: new Date().toISOString()
        };

        const metaUri = `internal://files/books/${bookName}/${META_FILE}`;
        await new Promise((resolve, reject) => {
            file.writeText({
                uri: metaUri,
                text: JSON.stringify(metaData),
                success: resolve,
                fail: reject
            });
        });
    } catch (e) {
    }
}

async function getProgressMeta(bookName) {
    const uri = `internal://files/books/${bookName}/${META_FILE}`;
    try {
        let data = await new Promise((resolve, reject) => {
            file.readText({ uri, success: resolve, fail: reject });
        });
        const result = JSON.parse(data.text);
        data = null;
        return result;
    } catch (e) {
        return null;
    }
}

export default {
    calculateAndSaveProgressMeta,
    getProgressMeta
};
