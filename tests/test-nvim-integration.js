// Test file for Neovim Codex Plugin
// This file contains various code patterns that can be improved by AI

// Old-style variable declarations
var userName = "John Doe";
var userAge = 25;
var isActive = true;

// String concatenation (can be modernized to template literals)
var greeting = "Hello " + userName + ", you are " + userAge + " years old!";
var message = "Welcome to our platform. Your status is: " + (isActive ? "active" : "inactive");

// Old-style function declarations (can be converted to arrow functions)
function calculateArea(width, height) {
    return width * height;
}

function processUser(user) {
    var result = "Processing user: " + user.name;
    if (user.age > 18) {
        result = result + " (Adult)";
    } else {
        result = result + " (Minor)";
    }
    return result;
}

// Callback-style async code (can be modernized to async/await)
function fetchUserData(userId, callback) {
    setTimeout(function() {
        var userData = {
            id: userId,
            name: "User " + userId,
            email: "user" + userId + "@example.com"
        };
        callback(null, userData);
    }, 1000);
}

// Error-prone code (needs error handling)
function parseJsonData(jsonString) {
    var data = JSON.parse(jsonString);
    return data.items.map(function(item) {
        return item.name.toUpperCase();
    });
}

// Complex nested loops (can be optimized)
function findDuplicates(arr) {
    var duplicates = [];
    for (var i = 0; i < arr.length; i++) {
        for (var j = i + 1; j < arr.length; j++) {
            if (arr[i] === arr[j]) {
                var found = false;
                for (var k = 0; k < duplicates.length; k++) {
                    if (duplicates[k] === arr[i]) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    duplicates.push(arr[i]);
                }
            }
        }
    }
    return duplicates;
}

// Undocumented complex algorithm (needs explanation)
function mysteriousAlgorithm(data) {
    var result = [];
    var temp = {};
    
    for (var i = 0; i < data.length; i++) {
        var key = data[i].category + "_" + data[i].type;
        if (!temp[key]) {
            temp[key] = [];
        }
        temp[key].push(data[i]);
    }
    
    for (var prop in temp) {
        if (temp[prop].length > 1) {
            var sum = 0;
            for (var j = 0; j < temp[prop].length; j++) {
                sum += temp[prop][j].value;
            }
            result.push({
                key: prop,
                total: sum,
                count: temp[prop].length,
                average: sum / temp[prop].length
            });
        }
    }
    
    return result.sort(function(a, b) {
        return b.total - a.total;
    });
}

// Main execution (can be improved with better structure)
var testData = [
    { category: "A", type: "1", value: 10 },
    { category: "A", type: "1", value: 20 },
    { category: "B", type: "2", value: 15 },
    { category: "A", type: "2", value: 25 }
];

console.log("Starting application...");
console.log("User: " + greeting);
console.log("Area: " + calculateArea(10, 5));
console.log("Duplicates in [1,2,2,3,3,4]: " + findDuplicates([1,2,2,3,3,4]));
console.log("Algorithm result:", mysteriousAlgorithm(testData));

fetchUserData(123, function(err, user) {
    if (err) {
        console.log("Error: " + err);
    } else {
        console.log("Fetched user: " + user.name);
    }
});

// Try parsing some JSON (this might fail)
try {
    var jsonResult = parseJsonData('{"items":[{"name":"test"}]}');
    console.log("Parsed data:", jsonResult);
} catch (e) {
    console.log("JSON parsing failed: " + e.message);
} 