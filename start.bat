@echo off
echo Starting SignVerify...

:: Start Flask backend
start "SignVerify Backend" cmd /k "cd /d "E:\PRA Mini Project\Signature Project\backend" && python app.py"

:: Wait 2 seconds for backend to start
timeout /t 2 /nobreak >nul

:: Start frontend server
start "SignVerify Frontend" cmd /k "cd /d "E:\PRA Mini Project\Signature Project\frontend" && npx serve . -p 8080"

:: Wait 2 seconds for frontend to start
timeout /t 2 /nobreak >nul

:: Open browser
start http://localhost:8080

echo Done! SignVerify is running at http://localhost:8080
