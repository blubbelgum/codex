// Test file for Codex Sidebar Demo
// This file contains various code patterns that can be improved

var userName = "John";
var userAge = 25;
var greeting = "Hello " + userName + ", you are " + userAge + " years old!";

function calculateArea(width, height) {
    return width * height;
}

function processUser(user) {
    if (user.name) {
        console.log("Processing user: " + user.name);
        return user.name.toUpperCase();
    }
    return null;
}

// Old-style callback function
function fetchData(callback) {
    setTimeout(function() {
        callback("data loaded");
    }, 1000);
}

// String concatenation that could use template literals
var message = "User " + userName + " has " + userAge + " years";
var htmlContent = "<div class='" + "user-card" + "'>" + message + "</div>";

// Function that could be modernized
feunction validateEmail(email) {
    var pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(email);
}

// Code that could benefit from async/await
function loadUserData(userId) {
a    return new Promise(function(resolve, reject) {
        setTimeout(function() {
            resolve({ id: userId, name: "User " + userId });
        }, 500)
    });
}
