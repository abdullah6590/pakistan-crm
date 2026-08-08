$env:DATABASE_URL="file:./test.db"

$counts = @(1000, 10000, 25000, 50000)

foreach ($count in $counts) {
    Write-Host "============================="
    Write-Host "RESETTING DB FOR $count..."
    npx prisma db push --force-reset
    Write-Host "RUNNING TEST $count..."
    npx tsx scripts/stress-test.ts --count=$count
    Write-Host "DONE $count"
}
