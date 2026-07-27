const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else {
            if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk(path.join(__dirname, 'src', 'app', 'api'));
let modified = 0;

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('mode: "insensitive"')) {
        content = content.replace(/,\s*mode:\s*"insensitive"/g, '');
        fs.writeFileSync(file, content, 'utf8');
        modified++;
        console.log(`Updated ${file}`);
    }
});

console.log(`Removed insensitive mode from ${modified} files.`);
