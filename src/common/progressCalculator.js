import file from '@system.file';
import chapterManager from './chapterManager.js';

const META_FILE = 'progress_meta.json';

async function calculateAndSaveProgressMeta(bookName) {
    try {
        const chapters = await chapterManager.loadChapterList(bookName);
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
                // Ignore missing chapter files
            }
        }

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
        // console.error(`Failed to calculate progress meta for ${bookName}:`, e);
    }
}

async function getProgressMeta(bookName) {
    const uri = `internal://files/books/${bookName}/${META_FILE}`;
    try {
        const data = await new Promise((resolve, reject) => {
            file.readText({ uri, success: resolve, fail: reject });
        });
        return JSON.parse(data.text);
    } catch (e) {
        return null;
    }
}

export default {
    calculateAndSaveProgressMeta,
    getProgressMeta
};
