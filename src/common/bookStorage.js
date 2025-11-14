import file from '@system.file';
import runAsyncFunc from '../utils/runAsyncFunc.js';

const BOOKSHELF_URI = 'internal://files/books/bookshelf.json';

let bookshelfCache = null;
let isDirty = false;

async function load() {
    if (bookshelfCache === null) {
        try {
            const data = await runAsyncFunc(file.readText, { uri: BOOKSHELF_URI });
            bookshelfCache = JSON.parse(data.text);
        } catch (e) {
            bookshelfCache = [];
        }
    }
}

async function save() {
    if (!isDirty || bookshelfCache === null) return;

    try {
        await runAsyncFunc(file.writeText, {
            uri: BOOKSHELF_URI,
            text: JSON.stringify(bookshelfCache),
        });
        isDirty = false;
    } catch (e) {
    }
}

async function get(bookDirName) {
    await load();
    const book = bookshelfCache.find(b => b.dirName === bookDirName);
    return book?.progress || { chapterIndex: null, offsetInChapter: 0, scrollOffset: 0, bookmarks: [] };
}

async function set(bookDirName, progressData) {
    await load();
    const bookIndex = bookshelfCache.findIndex(b => b.dirName === bookDirName);
    if (bookIndex !== -1) {
        if (!bookshelfCache[bookIndex].progress) {
            bookshelfCache[bookIndex].progress = {};
        }
        Object.assign(bookshelfCache[bookIndex].progress, progressData);
        isDirty = true;
        await save();
    }
}

async function getBooks() {
    try {
        const data = await runAsyncFunc(file.readText, { uri: BOOKSHELF_URI });
        bookshelfCache = JSON.parse(data.text);
    } catch (e) {
        bookshelfCache = [];
    }
    return JSON.parse(JSON.stringify(bookshelfCache || []));
}

async function updateBooks(newBookshelf) {
    bookshelfCache = newBookshelf;
    isDirty = true;
    await save();
}

async function removeBook(dirName) {
    await load();
    const initialLength = bookshelfCache.length;
    bookshelfCache = bookshelfCache.filter(b => b.dirName !== dirName);
    if (bookshelfCache.length < initialLength) {
        isDirty = true;
        await save();
    }
}

export default { get, set, getBooks, updateBooks, removeBook, load };
