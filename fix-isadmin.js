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
    if (content.match(/(isAdmin|canManageInventory|canManageFinance|canManageProjects|canViewAll)\(user\)/g)) {
        content = content.replace(/(isAdmin|canManageInventory|canManageFinance|canManageProjects|canViewAll)\(user\)/g, '$1(user.role)');
        fs.writeFileSync(file, content, 'utf8');
        modified++;
        console.log(`Updated ${file}`);
    }
});

console.log(`Replaced (user) with (user.role) in ${modified} files.`);
